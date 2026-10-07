// The storefront entry for a seller link: check the link, then (when Settings ask for it)
// make sure this device has entered an email code. `gateSeller()` guards the listing page and
// its actions (the workspace module); the code request and verify handlers are here.
import { getSettings } from "@/modules/core/index.js";
import { checkDeviceCredential, deviceFrom } from "./device.js";
import { requestEmailCode, verifyEmailCode } from "./email-codes.js";
import { checkFormToken, formTokenFrom, issueFormToken } from "./form-token.js";
import { clientIp, hit } from "./rate-limit.js";
import { resolveToken } from "./resolve.js";
import {
  codePage,
  sellerLayout,
  statePage,
  tooManyRequests,
  verifiedPage,
} from "./seller-pages.js";

const MINUTE_MS = 60 * 1000;

/**
 * Resolve the link and apply the page rate limit. Returns a response to send, or the invitation.
 * @param {import("@/modules/platform/services/proxy.js").ProxyContext} ctx
 * @param {Request} request
 * @param {unknown} token
 */
async function open(ctx, request, token) {
  const ip = clientIp(request);
  if (!hit(`seller-page:ip:${ip}`, { limit: 60, windowMs: MINUTE_MS }))
    return { response: await tooManyRequests(ctx.liquid) };
  const resolved = await resolveToken(token);
  if (resolved.state !== "OK")
    return {
      response: await statePage(ctx.liquid, resolved.state, resolved.reason),
    };
  return { ip, invitation: resolved.invitation, listing: resolved.listing };
}

const formOf = async (request) => {
  try {
    return await request.formData();
  } catch {
    return new FormData();
  }
};

const jsonFailure = (status, message) =>
  Response.json(
    { ok: false, message },
    {
      status,
      headers: {
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
      },
    },
  );

const STATE_MESSAGES = {
  INVALID: "This link doesn’t work.",
  EXPIRED: "This invitation has expired.",
  REVOKED: "This invitation was withdrawn.",
  CLOSED: "This listing has ended.",
};

/**
 * @typedef {object} SellerAccess
 * @property {object} invitation
 * @property {object} listing the row as it is now
 * @property {string} ip
 * @property {FormData | null} form the posted form (resume and action modes)
 * @property {{ type: "SELLER", ref: string }} actor the invitation id as the seller's ref
 * @property {string} formToken a fresh CSRF token for the next page
 */

/**
 * The gate in front of every seller page and action. It applies the rate limits, resolves the
 * link (status, expiry, deadlines), checks this device has entered a code when Settings ask for
 * one and, for actions, checks the form token. It returns a response to send, or the access.
 * - `page`: a GET. A device that hasn't proved itself gets the code page, which resumes by POST.
 * - `resume`: the POST from that page, carrying the device credential. Changes nothing.
 * - `action`: a POST that changes something. Needs the form token (403 without it).
 * @param {import("@/modules/platform/services/proxy.js").ProxyContext} ctx
 * @param {Request} request
 * @param {unknown} token
 * @param {{ mode?: "page" | "resume" | "action", json?: boolean }} [options] `json` answers
 *   with JSON errors instead of pages (for the browser's background calls)
 * @returns {Promise<{ response: Response } | SellerAccess>}
 */
export async function gateSeller(
  ctx,
  request,
  token,
  { mode = "page", json = false } = {},
) {
  const ip = clientIp(request);
  const limited = async () => ({
    response: json
      ? jsonFailure(429, "Too many requests. Try again in a minute.")
      : await tooManyRequests(ctx.liquid),
  });
  const [key, limit] =
    mode === "action" ? ["seller-action", 120] : ["seller-page", 60];
  if (!hit(`${key}:ip:${ip}`, { limit, windowMs: MINUTE_MS })) return limited();

  const resolved = await resolveToken(token);
  if (resolved.state !== "OK")
    return {
      response: json
        ? jsonFailure(410, STATE_MESSAGES[resolved.state])
        : await statePage(ctx.liquid, resolved.state, resolved.reason),
    };
  const { invitation, listing } = resolved;
  if (
    mode === "action" &&
    !hit(`seller-action:inv:${invitation.id}`, {
      limit: 60,
      windowMs: MINUTE_MS,
    })
  )
    return limited();

  const form = mode === "page" ? null : await formOf(request);
  const { emailCodeRequired } = await getSettings();
  if (
    emailCodeRequired &&
    !checkDeviceCredential(deviceFrom(request, form), invitation.id)
  )
    return {
      response: json
        ? jsonFailure(401, "Please confirm it’s you on this device.")
        : await codePage(ctx.liquid, {
            token: /** @type {string} */ (token),
            invitation,
            resume: mode === "page",
            notice:
              mode === "page"
                ? undefined
                : "Please confirm it’s you on this device.",
          }),
    };
  if (
    mode === "action" &&
    !checkFormToken(formTokenFrom(request, form), invitation.id)
  )
    return {
      response: json
        ? jsonFailure(403, "This page has expired. Reload it and try again.")
        : await sellerLayout(
            ctx.liquid,
            "This page has expired",
            "<p>For your security, the form has to be sent from a recent page. Open your listing link again and repeat the change.</p>",
            403,
          ),
    };

  return {
    invitation,
    listing,
    ip,
    form,
    actor: { type: "SELLER", ref: invitation.id },
    formToken: issueFormToken(invitation.id),
  };
}

const REQUEST_NOTICES = {
  SENT: "We’ve emailed you a code. It works for 15 minutes.",
  RATE_LIMITED:
    "You’ve asked for several codes. Please wait a few minutes and try again.",
  LOCKED: "Too many wrong codes. Please wait an hour and try again.",
  SEND_FAILED:
    "We couldn’t send your code just now. Please try again in a few minutes.",
};

/**
 * POST: email a new code.
 * @param {import("@/modules/platform/services/proxy.js").ProxyContext} ctx
 * @param {Request} request
 * @param {string} token
 * @returns {Promise<Response>}
 */
export async function handleCodeRequest(ctx, request, token) {
  const opened = await open(ctx, request, token);
  if (opened.response) return opened.response;
  const form = await formOf(request);
  // Honeypot: a person never fills this in. Answer as if it worked and send nothing.
  const trap = form.get("website");
  const { state } =
    typeof trap === "string" && trap !== ""
      ? { state: "SENT" }
      : await requestEmailCode(opened.invitation, { ip: opened.ip });
  if (state === "RATE_LIMITED") return tooManyRequests(ctx.liquid);
  return codePage(ctx.liquid, {
    token,
    invitation: opened.invitation,
    notice: REQUEST_NOTICES[state],
  });
}

/**
 * POST: check a code. A correct one stores the device credential and opens the listing.
 * @param {import("@/modules/platform/services/proxy.js").ProxyContext} ctx
 * @param {Request} request
 * @param {string} token
 * @returns {Promise<Response>}
 */
export async function handleCodeVerify(ctx, request, token) {
  const opened = await open(ctx, request, token);
  if (opened.response) return opened.response;
  const form = await formOf(request);
  const result = await verifyEmailCode(opened.invitation, form.get("code"), {
    ip: opened.ip,
  });
  if (result.state === "RATE_LIMITED") return tooManyRequests(ctx.liquid);
  if (result.state === "OK")
    return verifiedPage(ctx.liquid, {
      token,
      invitationId: opened.invitation.id,
      device: result.device,
    });
  const notice =
    result.state === "WRONG"
      ? `That code isn’t right. ${result.attemptsLeft} ${result.attemptsLeft === 1 ? "try" : "tries"} left.`
      : result.state === "LOCKED"
        ? REQUEST_NOTICES.LOCKED
        : "That code has expired. Ask for a new one.";
  return codePage(ctx.liquid, { token, invitation: opened.invitation, notice });
}
