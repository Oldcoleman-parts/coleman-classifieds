// The pay page behind the private payment link: GET shows the fee and one button, POST
// starts the checkout. A GET never has an effect, because mail scanners open links.
import { escapeHtml as h, sellerLayout } from "@/modules/access/index.js";
import { ConflictError } from "@/modules/core/index.js";
import { clientIp, rateLimit } from "@/modules/platform/index.js";
import { HOUR_MS, MINUTE_MS, PAY_PATH } from "./constants.js";
import { createCheckout } from "./checkout.js";
import { AWAITING, canPay, loadPayable } from "./facts.js";
import { reportPaymentProblem } from "./incidents.js";
import { checkPayRef, readPayRef } from "./pay-link.js";
import { formatDay, money } from "./shop.js";

/**
 * @typedef {import("@/modules/platform/services/proxy.js").ProxyContext} ProxyContext
 * @typedef {import("./facts.js").Payable} Payable
 */

// DECISION (F06-FIX-1): every page here is served with 200. Shopify's app proxy replaces an
// error status with its own "error in the third-party application" page, so the seller would
// never read ours. The limits and the payment problems are unchanged.
const page = (ctx, title, text) =>
  sellerLayout(ctx.liquid, title, `<p>${h(text)}</p>`);

const tooMany = (ctx) =>
  page(
    ctx,
    "Please wait a moment",
    "There have been too many requests. Try again in a few minutes.",
  );

const invalid = (ctx) =>
  page(
    ctx,
    "This payment link doesn’t work",
    "Check that you opened the newest payment email from Old Coleman Parts. If it still doesn’t open, contact us.",
  );

/**
 * The listing behind a link, or the page that explains why it can't be paid for.
 * DECISION (F06-T1): no CSRF token. The app proxy strips cookies, so there is no ambient
 * sign-in to abuse; the signed reference in the address is the whole permission.
 * @param {ProxyContext} ctx
 * @param {string | undefined} ref
 * @param {Date} now
 * @returns {Promise<{ payable: Payable } | { response: Response }>}
 */
async function resolve(ctx, ref, now) {
  const parsed = readPayRef(ref);
  const payable = parsed ? await loadPayable(parsed.listingId) : null;
  // An unknown listing and a wrong signature get the same answer.
  if (!parsed || !payable || !checkPayRef(parsed, payable))
    return { response: await invalid(ctx) };
  if (payable.liveAt)
    return {
      response: await page(
        ctx,
        "This listing is already paid",
        "Thank you. There is nothing more to pay for this listing.",
      ),
    };
  if (payable.status !== AWAITING || !canPay(payable, now))
    return {
      response: await page(
        ctx,
        "The payment window has passed",
        "This listing wasn’t paid for in time, so it didn’t go live. Contact Old Coleman Parts if you’d still like to list it.",
      ),
    };
  return { payable };
}

/**
 * GET /apps/classifieds/pay/:ref
 * @param {ProxyContext} ctx
 * @param {Request} request
 * @param {string | undefined} ref
 * @param {{ now?: Date }} [options]
 * @returns {Promise<Response>}
 */
export async function handlePayPage(
  ctx,
  request,
  ref,
  { now = new Date() } = {},
) {
  if (
    !rateLimit(`pay-page:ip:${clientIp(request)}`, {
      limit: 60,
      windowMs: MINUTE_MS,
    })
  )
    return tooMany(ctx);
  const found = await resolve(ctx, ref, now);
  if ("response" in found) return found.response;
  const { payable } = found;
  const { feeRegularCents, feeOfferedCents } = payable.invitation;
  const price =
    feeOfferedCents < feeRegularCents
      ? `<s>${h(money(feeRegularCents))}</s> <strong>${h(money(feeOfferedCents))}</strong>`
      : `<strong>${h(money(feeOfferedCents))}</strong>`;
  return sellerLayout(
    ctx.liquid,
    "Pay and publish your listing",
    `<p>Your listing <strong>${h(payable.title ?? "")}</strong> has been approved.</p>
<p>Listing fee: ${price} for one calendar month.</p>
<p>Please pay by <strong>${h(formatDay(/** @type {Date} */ (payable.paymentDueBy)))}</strong>. You pay through the Old Coleman Parts checkout, and your listing goes live as soon as payment is received.</p>
<form method="post" action="${h(`${PAY_PATH}/${ref}`)}">
<div class="cc-actions"><button type="submit" class="button">Pay and publish</button></div></form>`,
  );
}

/**
 * POST /apps/classifieds/pay/:ref: start the checkout and send the seller to it.
 * @param {ProxyContext} ctx
 * @param {Request} request
 * @param {string | undefined} ref
 * @param {{ now?: Date }} [options]
 * @returns {Promise<Response>}
 */
export async function handlePay(ctx, request, ref, { now = new Date() } = {}) {
  if (
    !rateLimit(`pay:ip:${clientIp(request)}`, {
      limit: 10,
      windowMs: MINUTE_MS,
    })
  )
    return tooMany(ctx);
  const found = await resolve(ctx, ref, now);
  if ("response" in found) return found.response;
  const { payable } = found;
  if (!rateLimit(`pay:listing:${payable.id}`, { limit: 10, windowMs: HOUR_MS }))
    return tooMany(ctx);

  try {
    const { checkoutUrl } = await createCheckout(payable, {
      admin: ctx.admin,
      shop: ctx.shop,
      now,
    });
    return new Response(null, {
      status: 303,
      headers: {
        Location: checkoutUrl,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    // Paid or lapsed between the page and the click: show the matching page.
    if (error instanceof ConflictError)
      return (await resolve(ctx, ref, now)).response ?? invalid(ctx);
    await reportPaymentProblem(
      `checkout-failed:${payable.id}`,
      "A seller could not start the checkout for an approved listing.",
      { code: error?.code ?? error?.name ?? "Error" },
      { listingId: payable.id, now },
    );
    return page(
      ctx,
      "We couldn’t open the checkout",
      "Something went wrong on our side and you have not been charged. Please try again in a few minutes, or contact Old Coleman Parts.",
    );
  }
}
