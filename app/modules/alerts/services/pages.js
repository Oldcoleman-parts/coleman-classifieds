// The alerts pages under /apps/classifieds/alerts: signup, confirm, unsubscribe, resubscribe.
// Every page is status 200 (the app proxy hides error statuses), apart from the 404 when
// alerts are switched off. No page says whether an address is subscribed.
import { escapeHtml as h, sellerLayout } from "@/modules/access/index.js";
import { isEnabled, ValidationError } from "@/modules/core/index.js";
import { clientIp, rateLimit } from "@/modules/platform/index.js";
import { cleanEmail, emailKey } from "./clean.js";
import {
  ALERTS_PATH,
  CONFIRM_PATH,
  RESUBSCRIBE_PATH,
  storefrontBase,
  UNSUBSCRIBE_PATH,
} from "./links.js";
import {
  confirm,
  findByUnsubscribeToken,
  resubscribe,
  subscribe,
  unsubscribeById,
} from "./subscribers.js";
import { turnstileSiteKey, verifyTurnstile } from "./turnstile.js";

/** @typedef {import("@/modules/platform/services/proxy.js").ProxyContext} ProxyContext */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MAX_FORM_BYTES = 8 * 1024;
const MAX_TOKEN = 200;

const notFound = () => new Response(null, { status: 404 });

/** @param {ProxyContext} ctx @param {string} title @param {string} body HTML */
const layout = (ctx, title, body) => sellerLayout(ctx.liquid, title, body);

/** @param {ProxyContext} ctx @param {string} title @param {string} text */
const page = (ctx, title, text) => layout(ctx, title, `<p>${h(text)}</p>`);

const tooMany = (ctx) =>
  page(
    ctx,
    "Please wait a moment",
    "There have been too many requests. Try again later.",
  );

// The same page whatever happened to the address: new, pending, active, unsubscribed,
// suppressed, or a bot that filled the honeypot.
const checkEmail = (ctx) =>
  page(
    ctx,
    "Check your email",
    "If this address can receive alerts, we’ve sent it a link. Open it to confirm your subscription.",
  );

const badLink = (ctx) =>
  page(
    ctx,
    "This link isn’t valid",
    "This link has expired or has already been used. You can sign up again from the classifieds page.",
  );

/**
 * A one-button form that posts the token back. Confirm and unsubscribe both ask for a click,
 * so an email scanner that opens links can't act for the subscriber.
 * @param {string} action
 * @param {string} token
 * @param {string} label
 */
const tokenButton = (action, token, label) =>
  `<form method="post" action="${h(action)}"><input type="hidden" name="t" value="${h(token)}"><button type="submit" class="button">${h(label)}</button></form>`;

/**
 * @param {ProxyContext} ctx
 * @param {{ notice?: string, email?: string }} [options]
 */
function signupForm(ctx, { notice, email = "" } = {}) {
  return layout(
    ctx,
    "New listing alerts",
    `${notice ? `<p role="status"><strong>${h(notice)}</strong></p>` : ""}
<p>Get an email each time a new listing goes up on Old Coleman Parts Classifieds. You can unsubscribe at any time.</p>
<form method="post" action="${h(ALERTS_PATH)}">
<label for="cc-alerts-email">Your email address</label>
<input id="cc-alerts-email" type="email" name="email" autocomplete="email" maxlength="254" required value="${h(email)}" style="display:block;width:100%;max-width:100%;margin:.25rem 0 1rem">
<div style="position:absolute;left:-10000px" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<div class="cf-turnstile" data-sitekey="${h(turnstileSiteKey())}" style="margin-bottom:1rem"></div>
<button type="submit" class="button">Sign up for alerts</button>
</form>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`,
  );
}

/**
 * @param {ProxyContext} ctx
 * @param {string} token the unsubscribe token
 * @param {boolean} canResubscribe
 */
const unsubscribed = (ctx, token, canResubscribe) =>
  layout(
    ctx,
    "You’re unsubscribed",
    `<p>You won’t get any more new listing alerts.</p>${
      canResubscribe
        ? `<p>Changed your mind?</p>${tokenButton(RESUBSCRIBE_PATH, token, "Resubscribe")}`
        : ""
    }`,
  );

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

/** @param {string} value @returns {string} "" when it can't be a token */
const token = (value) => (value.length <= MAX_TOKEN ? value : "");

/** The token from the address (`?t=`), where the email links and Gmail put it. */
const queryToken = (ctx) => token(ctx.url.searchParams.get("t") ?? "");

/** @param {Request} request @param {string} name @param {number} limit @param {number} windowMs */
const allowed = (request, name, limit, windowMs) =>
  rateLimit(`alerts-${name}:ip:${clientIp(request)}`, { limit, windowMs });

/**
 * GET /apps/classifieds/alerts: the shareable signup page. Works with no listings.
 * @param {ProxyContext} ctx
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function handleSignupPage(ctx, request) {
  if (!(await isEnabled("alerts"))) return notFound();
  if (!allowed(request, "page", 60, MINUTE_MS)) return tooMany(ctx);
  return signupForm(ctx);
}

/**
 * POST /apps/classifieds/alerts, from this page or the theme's signup block.
 * @param {ProxyContext} ctx
 * @param {Request} request
 * @param {{ now?: Date }} [options]
 * @returns {Promise<Response>}
 */
export async function handleSignupSubmit(
  ctx,
  request,
  { now = new Date() } = {},
) {
  if (!(await isEnabled("alerts"))) return notFound();
  const ip = clientIp(request);
  if (!rateLimit(`alerts:ip:${ip}`, { limit: 10, windowMs: HOUR_MS }))
    return tooMany(ctx);
  const data = await formOf(request);
  if (text(data, "website") !== "") return checkEmail(ctx);
  const email = text(data, "email").slice(0, 254);

  // DECISION (F07-T2): the theme block posts the email only, so Cloudflare's script never
  // loads on theme pages. That post gets this page's form back, with the check.
  if (!data.has("cf-turnstile-response")) return signupForm(ctx, { email });
  if (!(await verifyTurnstile(data.get("cf-turnstile-response"), ip)))
    return signupForm(ctx, {
      notice: "Please complete the security check and try again.",
      email,
    });

  let clean;
  try {
    clean = cleanEmail(data.get("email"));
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return signupForm(ctx, {
      notice: "Please check your email address.",
      email,
    });
  }
  if (
    !rateLimit(`alerts:email:${emailKey(clean)}`, {
      limit: 3,
      windowMs: DAY_MS,
    })
  )
    return tooMany(ctx);

  await subscribe(clean, { base: await storefrontBase(ctx), now });
  return checkEmail(ctx);
}

/**
 * GET and POST /apps/classifieds/alerts/confirm. GET shows the button; POST confirms.
 * @param {ProxyContext} ctx
 * @param {Request} request
 * @param {{ now?: Date }} [options]
 * @returns {Promise<Response>}
 */
export async function handleConfirm(ctx, request, { now = new Date() } = {}) {
  if (!(await isEnabled("alerts"))) return notFound();
  if (!allowed(request, "confirm", 30, MINUTE_MS)) return tooMany(ctx);
  if (request.method !== "POST") {
    const t = queryToken(ctx);
    if (!t) return badLink(ctx);
    return layout(
      ctx,
      "Confirm your subscription",
      `<p>Confirm to get an email each time a new listing goes up.</p>${tokenButton(CONFIRM_PATH, t, "Confirm subscription")}`,
    );
  }
  const t = token(text(await formOf(request), "t"));
  if (!(await confirm(t, { now }))) return badLink(ctx);
  return page(
    ctx,
    "You’re subscribed",
    "Thank you. You’ll get an email each time a new listing goes up. Every email has an unsubscribe link.",
  );
}

/**
 * GET /apps/classifieds/alerts/unsubscribe: the unsubscribe button (works with alerts off).
 * @param {ProxyContext} ctx
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function handleUnsubscribePage(ctx, request) {
  if (!allowed(request, "unsubscribe", 30, MINUTE_MS)) return tooMany(ctx);
  const t = queryToken(ctx);
  const row = await findByUnsubscribeToken(t);
  if (!row) return badLink(ctx);
  if (row.unsubscribedAt !== null)
    return unsubscribed(ctx, t, await isEnabled("alerts"));
  return layout(
    ctx,
    "Unsubscribe from new listing alerts",
    `<p>You’ll stop getting new listing alerts.</p>${tokenButton(UNSUBSCRIBE_PATH, t, "Unsubscribe")}`,
  );
}

/**
 * POST /apps/classifieds/alerts/unsubscribe: the button above, and the mail app's one-click
 * unsubscribe (RFC 8058, `List-Unsubscribe=One-Click` posted to the header's address).
 * Works without login and with alerts off.
 * @param {ProxyContext} ctx
 * @param {Request} request
 * @param {{ now?: Date }} [options]
 * @returns {Promise<Response>}
 */
export async function handleUnsubscribePost(
  ctx,
  request,
  { now = new Date() } = {},
) {
  // Mail providers post one-click unsubscribes from shared servers, so this limit is high;
  // the token can't be guessed, so it only stops floods.
  if (!allowed(request, "unsubscribe-post", 300, MINUTE_MS))
    return tooMany(ctx);
  const t = queryToken(ctx) || token(text(await formOf(request), "t"));
  const row = await findByUnsubscribeToken(t);
  if (!row) return badLink(ctx);
  const via = ctx.url.searchParams.has("t") ? "ONE_CLICK" : "LINK";
  await unsubscribeById(row.id, { via, now });
  return unsubscribed(ctx, t, await isEnabled("alerts"));
}

/**
 * POST /apps/classifieds/alerts/resubscribe, from the unsubscribed page: a new confirm link.
 * DECISION (F07-T2): resubscribing is a signup, so it is off while alerts are off.
 * @param {ProxyContext} ctx
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function handleResubscribe(ctx, request) {
  if (!(await isEnabled("alerts"))) return notFound();
  if (!allowed(request, "resubscribe", 10, HOUR_MS)) return tooMany(ctx);
  const row = await findByUnsubscribeToken(
    token(text(await formOf(request), "t")),
  );
  if (!row) return badLink(ctx);
  if (
    !rateLimit(`alerts-resubscribe:id:${row.id}`, {
      limit: 3,
      windowMs: DAY_MS,
    })
  )
    return tooMany(ctx);
  await resubscribe(row, { base: await storefrontBase(ctx) });
  return checkEmail(ctx);
}
