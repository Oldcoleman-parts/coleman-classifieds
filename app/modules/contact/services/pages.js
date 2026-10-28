// The contact form behind "Contact the seller" (`/apps/classifieds/contact/:handle`).
// GET shows the form; POST checks the bot guards and limits, then delivers or holds.
// The seller's address never appears here: only the listing title is shown.
import { escapeHtml as h, sellerLayout } from "@/modules/access/index.js";
import { ValidationError } from "@/modules/core/index.js";
import { clientIp, rateLimit } from "@/modules/platform/index.js";
import {
  buyerKey,
  cleanBody,
  cleanEmail,
  cleanName,
  MAX_BODY,
  MAX_NAME,
} from "./clean.js";
import { findOpenListingByHandle } from "./facts.js";
import { submitMessage } from "./messages.js";
import { turnstileSiteKey, verifyTurnstile } from "./turnstile.js";

/** @typedef {import("@/modules/platform/services/proxy.js").ProxyContext} ProxyContext */

export const CONTACT_PATH = "/apps/classifieds/contact";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// A form with a 2000-character message is far below this.
const MAX_FORM_BYTES = 32 * 1024;

// DECISION (F07-T1): every page is served with 200, as on the pay page (F06-FIX-1): the app
// proxy replaces an error status with its own page, so the buyer would never read ours.
const page = (ctx, title, text) =>
  sellerLayout(ctx.liquid, title, `<p>${h(text)}</p>`);

const tooMany = (ctx) =>
  page(
    ctx,
    "Please wait a moment",
    "There have been too many messages. Try again later.",
  );

const closed = (ctx) =>
  page(
    ctx,
    "This listing isn’t taking messages",
    "This listing is no longer available, so the seller can’t be contacted through it.",
  );

// DECISION (F07-T1): a held message gets the same reply as a delivered one, so whoever sent
// it can't tell what was held. Bots that fill the honeypot get it too.
const sent = (ctx) =>
  page(
    ctx,
    "Your message has been sent",
    "Thank you. The seller will reply to you by email if they’re interested.",
  );

/**
 * @param {ProxyContext} ctx
 * @param {{ handle: string, title: string }} listing
 * @param {{ notice?: string, values?: { name?: string, email?: string, message?: string } }} [options]
 */
function form(ctx, listing, { notice, values = {} } = {}) {
  return sellerLayout(
    ctx.liquid,
    "Contact the seller",
    `${notice ? `<p role="status"><strong>${h(notice)}</strong></p>` : ""}
<p>About <strong>${h(listing.title)}</strong>. Your message goes to the seller by email. Old Coleman Parts doesn’t take part in the sale.</p>
<form method="post" action="${h(`${CONTACT_PATH}/${listing.handle}`)}">
<label for="cc-name">Your name (Shared with the seller)</label>
<input id="cc-name" type="text" name="name" autocomplete="name" maxlength="${MAX_NAME}" required value="${h(values.name ?? "")}" style="display:block;width:100%;max-width:100%;margin:.25rem 0 1rem">
<label for="cc-email">Your email address (Shared with the seller only, so they can reply)</label>
<input id="cc-email" type="email" name="email" autocomplete="email" maxlength="254" required value="${h(values.email ?? "")}" style="display:block;width:100%;max-width:100%;margin:.25rem 0 1rem">
<label for="cc-message">Message</label>
<textarea id="cc-message" name="message" rows="7" maxlength="${MAX_BODY}" required style="display:block;width:100%;max-width:100%;margin:.25rem 0 1rem">${h(values.message ?? "")}</textarea>
<div style="position:absolute;left:-10000px" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<div class="cf-turnstile" data-sitekey="${h(turnstileSiteKey())}" style="margin-bottom:1rem"></div>
<button type="submit" class="button">Send message</button>
</form>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`,
  );
}

/** @param {Request} request */
async function formOf(request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_FORM_BYTES) return new FormData();
  try {
    return await request.formData();
  } catch {
    return new FormData();
  }
}

/** @param {FormData} data @param {string} key */
const text = (data, key) => {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
};

/**
 * GET /apps/classifieds/contact/:handle
 * @param {ProxyContext} ctx
 * @param {Request} request
 * @param {string | undefined} handle
 * @param {{ now?: Date }} [options]
 * @returns {Promise<Response>}
 */
export async function handleContactPage(
  ctx,
  request,
  handle,
  { now = new Date() } = {},
) {
  if (
    !rateLimit(`contact-page:ip:${clientIp(request)}`, {
      limit: 60,
      windowMs: MINUTE_MS,
    })
  )
    return tooMany(ctx);
  const listing = await findOpenListingByHandle(handle, now);
  if (!listing) return closed(ctx);
  return form(ctx, {
    handle: /** @type {string} */ (handle),
    title: listing.title,
  });
}

/**
 * POST /apps/classifieds/contact/:handle
 * @param {ProxyContext} ctx
 * @param {Request} request
 * @param {string | undefined} handle
 * @param {{ now?: Date }} [options]
 * @returns {Promise<Response>}
 */
export async function handleContactSubmit(
  ctx,
  request,
  handle,
  { now = new Date() } = {},
) {
  const ip = clientIp(request);
  // DECISION (F07-T1): blocked attempts (rate limit, honeypot, Turnstile) are turned away
  // and not stored, so no bot data is kept. The BLOCKED status stays unused.
  if (!rateLimit(`contact:ip:${ip}`, { limit: 10, windowMs: HOUR_MS }))
    return tooMany(ctx);
  const data = await formOf(request);
  if (text(data, "website") !== "") return sent(ctx);

  const listing = await findOpenListingByHandle(handle, now);
  if (!listing) return closed(ctx);
  const shown = {
    handle: /** @type {string} */ (handle),
    title: listing.title,
  };
  const values = {
    name: text(data, "name").slice(0, MAX_NAME),
    email: text(data, "email").slice(0, 254),
    message: text(data, "message").slice(0, MAX_BODY),
  };
  if (!(await verifyTurnstile(data.get("cf-turnstile-response"), ip)))
    return form(ctx, shown, {
      notice: "Please complete the security check and try again.",
      values,
    });

  let input;
  try {
    input = {
      name: cleanName(data.get("name")),
      email: cleanEmail(data.get("email")),
      body: cleanBody(data.get("message")),
    };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return form(ctx, shown, {
      notice: "Please check your name, email address and message.",
      values,
    });
  }

  if (
    !rateLimit(`contact:email:${buyerKey(input.email)}`, {
      limit: 5,
      windowMs: HOUR_MS,
    }) ||
    !rateLimit(`contact:listing:${listing.id}`, { limit: 20, windowMs: DAY_MS })
  )
    return tooMany(ctx);

  const { outcome } = await submitMessage(
    { listingId: listing.id, ...input, ip },
    { now },
  );
  if (outcome === "FAILED")
    return form(ctx, shown, {
      notice:
        "We couldn’t send your message right now. Please try again in a few minutes.",
      values,
    });
  return sent(ctx);
}
