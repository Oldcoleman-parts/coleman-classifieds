// The storefront entry for a seller link: check the link, then (when Settings ask for it)
// make sure this device has entered an email code. Route files call these and nothing else.
import { getSettings } from "@/modules/core/index.js";
import { checkDeviceCredential, deviceFrom } from "./device.js";
import { requestEmailCode, verifyEmailCode } from "./email-codes.js";
import { clientIp, hit } from "./rate-limit.js";
import { resolveToken } from "./resolve.js";
import {
  codePage,
  listingPlaceholder,
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
    return { response: tooManyRequests(ctx.liquid) };
  const resolved = await resolveToken(token);
  if (resolved.state !== "OK")
    return { response: statePage(ctx.liquid, resolved.state) };
  return { ip, invitation: resolved.invitation, listing: resolved.listing };
}

const formOf = async (request) => {
  try {
    return await request.formData();
  } catch {
    return new FormData();
  }
};

/**
 * GET the seller page. With codes required, a device that has signed in before resumes by
 * POSTing its credential; private details are never sent to an unverified device.
 * @param {import("@/modules/platform/services/proxy.js").ProxyContext} ctx
 * @param {Request} request
 * @param {string} token
 * @returns {Promise<Response>}
 */
export async function handleSellerPage(ctx, request, token) {
  const opened = await open(ctx, request, token);
  if (opened.response) return opened.response;
  const { emailCodeRequired } = await getSettings();
  if (!emailCodeRequired) return listingPlaceholder(ctx.liquid, opened);
  if (checkDeviceCredential(deviceFrom(request), opened.invitation.id))
    return listingPlaceholder(ctx.liquid, opened);
  return codePage(ctx.liquid, {
    token,
    invitation: opened.invitation,
    resume: true,
  });
}

/**
 * POST to the seller page with a device credential (the resume step).
 * @param {import("@/modules/platform/services/proxy.js").ProxyContext} ctx
 * @param {Request} request
 * @param {string} token
 * @returns {Promise<Response>}
 */
export async function handleSellerPost(ctx, request, token) {
  const opened = await open(ctx, request, token);
  if (opened.response) return opened.response;
  const form = await formOf(request);
  const { emailCodeRequired } = await getSettings();
  if (
    !emailCodeRequired ||
    checkDeviceCredential(deviceFrom(request, form), opened.invitation.id)
  )
    return listingPlaceholder(ctx.liquid, opened);
  return codePage(ctx.liquid, {
    token,
    invitation: opened.invitation,
    notice: "Please confirm it’s you on this device.",
  });
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
