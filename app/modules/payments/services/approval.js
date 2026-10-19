// What happens when staff approve (or re-issue) a listing: the discount code, then the
// `approved_pay` email with the private payment link. Core has already set `paymentDueBy`.
import { getSettings } from "@/modules/core/index.js";
import { send } from "@/modules/notifications/index.js";
import { DAY_MS, HOUR_MS } from "./constants.js";
import { ensureDiscount } from "./discount.js";
import { canPay, discountFor, loadPayable } from "./facts.js";
import { reportPaymentProblem } from "./incidents.js";
import { payLink } from "./pay-link.js";
import { ensureFeeSetup, syncFeePrice } from "./setup.js";
import {
  formatDay,
  money,
  offlineAdmin,
  shopDomain,
  storefrontBase,
} from "./shop.js";

/**
 * @typedef {import("./facts.js").Payable} Payable
 * @typedef {import("@/modules/platform/services/graphql.js").GraphqlClient} GraphqlClient
 */

const MAX_TRIES = 3;

/**
 * Send a seller email that carries the pay link, at most three times, an hour apart.
 * DECISION (F06-T1): these templates are `sensitive`, so a failed send is never queued. The
 * try number is part of the idempotency key: try `k` is only made once `k` hours have passed
 * since `since`, and a key that was already used sends nothing. No extra column is needed.
 * @param {"approved_pay" | "payment_reminder"} template
 * @param {Payable} payable
 * @param {{ admin: GraphqlClient, shop: string, since: Date, now: Date }} context
 * @returns {Promise<string>} the outbox status of the last try
 */
export async function sendPayEmail(
  template,
  payable,
  { admin, shop, since, now },
) {
  const due = /** @type {Date} */ (payable.paymentDueBy);
  const { invitation } = payable;
  const vars = {
    seller_first_name: invitation.sellerName.trim().split(/\s+/)[0] ?? "",
    payment_due_date: formatDay(due),
    pay_link: payLink(await storefrontBase(admin, shop), payable.id, due),
    ...(template === "approved_pay"
      ? {
          listing_title: payable.title ?? "",
          fee_amount: money(invitation.feeOfferedCents),
        }
      : {}),
  };
  const hours = Math.floor((now.getTime() - since.getTime()) / HOUR_MS);
  const tries = Math.min(MAX_TRIES, Math.max(1, hours + 1));
  let status = "FAILED";
  for (let k = 0; k < tries && status === "FAILED"; k++) {
    ({ status } = await send(template, invitation.sellerEmail, vars, {
      idempotencyKey: `${template}:${payable.id}:${due.getTime()}:${k}`,
      now,
    }));
  }
  return status;
}

/**
 * Prepare one approved listing for payment. Safe to repeat: the code is created once and
 * the email is sent once.
 * @param {string} listingId
 * @param {{ admin: GraphqlClient, shop: string, now?: Date, fresh?: boolean }} context
 *   `fresh` is true for the approval itself: the code is then created even if an id is stored
 * @returns {Promise<"DONE" | "SKIPPED" | "EMAIL_FAILED">}
 */
export async function prepareForPayment(
  listingId,
  { admin, shop, now = new Date(), fresh = false },
) {
  const payable = await loadPayable(listingId);
  // A stale or repeated event: paid, lapsed or closed in the meantime.
  if (!payable || !canPay(payable, now)) return "SKIPPED";

  // The code comes before the email, so the link never opens a full-price checkout. The
  // price is brought in line with the base fee first, because the code is based on it.
  // A locked fee above the price makes no code; the checkout refuses it (FEE_ABOVE_PRICE).
  if (fresh || !payable.discountCodeId) {
    const { feeVariantGid } = await ensureFeeSetup({ admin });
    const priceCents = await syncFeePrice({ admin, feeVariantGid });
    await ensureDiscount(payable, {
      admin,
      feeVariantGid,
      amountCents: discountFor(payable, priceCents),
      now,
    });
  }

  const { paymentWindowDays } = await getSettings();
  const since = new Date(
    /** @type {Date} */ (payable.paymentDueBy).getTime() -
      paymentWindowDays * DAY_MS,
  );
  const status = await sendPayEmail("approved_pay", payable, {
    admin,
    shop,
    since,
    now,
  });
  return status === "FAILED" ? "EMAIL_FAILED" : "DONE";
}

/**
 * The `ListingApproved` listener (an approval or a re-issue). It never throws: an approval
 * is not undone by a Shopify or email problem. The hourly follow-up task tries again.
 * @param {{ listingId: string }} payload
 * @returns {Promise<void>}
 */
export async function onListingApproved({ listingId }) {
  try {
    const admin = await offlineAdmin();
    await prepareForPayment(listingId, {
      admin,
      shop: shopDomain(),
      fresh: true,
    });
  } catch (error) {
    await reportPaymentProblem(
      `approval-setup:${listingId}`,
      "The payment step of an approved listing could not be prepared.",
      { code: error?.code ?? error?.name ?? "Error" },
      { listingId },
    );
  }
}
