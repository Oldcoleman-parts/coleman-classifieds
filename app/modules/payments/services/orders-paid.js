// The `orders/paid` webhook. HMAC and the receipt are handled by `platform.handleWebhook()`.
// A delivery may run twice (F01-FIX-2), so every step checks before it writes.
import prisma from "@/db.server";
import {
  EVENTS,
  getSettings,
  publish,
  writeAudit,
} from "@/modules/core/index.js";
import { discountCodeFor } from "./discount.js";
import { loadPayable } from "./facts.js";
import { ensureFulfilled } from "./fulfil.js";
import { reportPaymentProblem } from "./incidents.js";
import { readOrder } from "./order-payload.js";
import { ensurePeriod } from "./periods.js";

/**
 * @typedef {import("./order-payload.js").FeeOrderFacts} FeeOrderFacts
 * @typedef {import("./facts.js").Payable} Payable
 */

// DECISION (F06-T1): in production a test order never publishes a listing. Staging on a dev
// store sets FEE_TEST_ORDERS=allow.
const testOrdersAllowed = () =>
  process.env.NODE_ENV !== "production" ||
  process.env.FEE_TEST_ORDERS === "allow";

/**
 * Why this order must not publish the listing it names, or null when everything matches.
 * The cart attribute only nominates a listing: anyone can set it. The order must also be
 * exactly one fee variant at exactly that listing's locked fee, with its own discount code.
 * @param {FeeOrderFacts} order
 * @param {Payable | null} payable
 * @param {string | null} feeVariantGid
 * @returns {string | null}
 */
function mismatch(order, payable, feeVariantGid) {
  if (!order.hasAttribute) return "NO_ATTRIBUTE";
  if (!payable) return "UNKNOWN_LISTING";
  const [line] = order.lines;
  if (!feeVariantGid || order.lines.length !== 1 || line.quantity !== 1)
    return "LINES";
  if (line.variantGid !== feeVariantGid) return "VARIANT";
  if (order.subtotalCents !== payable.invitation.feeOfferedCents)
    return "AMOUNT";
  // DECISION (F06-FIX-1): the listing's own code is the only one allowed, and it must be there
  // whenever the order's line price is above the locked fee. Today's price isn't needed, so
  // an invitation made before a fee change still matches.
  const own = payable.paymentDueBy
    ? discountCodeFor(payable.id, payable.paymentDueBy)
    : null;
  if (
    order.discountCodes.some((code) => code !== own) ||
    (line.priceCents !== payable.invitation.feeOfferedCents &&
      !(own && order.discountCodes.includes(own)))
  )
    return "DISCOUNT";
  if (order.hasShipping) return "SHIPPING";
  if (order.test && !testOrdersAllowed()) return "TEST_ORDER";
  return null;
}

/**
 * @param {string} orderGid
 * @param {{ admin: object }} context
 * @returns {Promise<Error | null>} the error, so going live never waits on fulfilment
 */
async function fulfil(orderGid, { admin }) {
  try {
    const { fulfilled } = await ensureFulfilled(orderGid, { admin });
    if (fulfilled > 0)
      await writeAudit({
        action: "FeeOrderFulfilled",
        details: { orderGid, fulfilled },
      });
    return null;
  } catch (error) {
    return error;
  }
}

/**
 * @param {{ payload: unknown, admin: object }} delivery from `platform.handleWebhook()`
 * @returns {Promise<void>} a rejection makes the webhook answer 500, so Shopify retries
 */
export async function handleOrderPaid({ payload, admin }) {
  const order = readOrder(payload);
  if (!order) return;
  const { feeVariantGid } = await getSettings();
  const hasFeeLine =
    !!feeVariantGid &&
    order.lines.some((line) => line.variantGid === feeVariantGid);
  // An ordinary store order: nothing to do, and nothing is written.
  if (!order.hasAttribute && !hasFeeLine) return;

  const { orderGid } = order;
  const payable = order.listingId ? await loadPayable(order.listingId) : null;
  const reason = mismatch(order, payable, feeVariantGid);
  if (reason) {
    // No charge is recorded and nothing is published. Staff decide (usually a refund).
    const unmatched = ["NO_ATTRIBUTE", "UNKNOWN_LISTING"].includes(reason);
    await reportPaymentProblem(
      `${unmatched ? "unmatched-order" : "fee-mismatch"}:${orderGid}`,
      "A paid order doesn't match the listing fee it claims to pay.",
      { orderGid, reason },
      { listingId: payable?.id ?? null },
    );
    // An order that is only the fee line still has nothing to ship.
    if (hasFeeLine && order.lines.length === 1)
      await fulfil(orderGid, { admin });
    return;
  }
  const listingId = /** @type {Payable} */ (payable).id;

  // The charge is saved before the event goes out; a retried delivery finds it and goes on.
  try {
    await prisma.$transaction(async (tx) => {
      const charge = await tx.feeCharge.create({
        data: {
          listingId,
          kind: "INITIAL",
          orderGid,
          amountCents: /** @type {number} */ (order.subtotalCents),
          status: "PAID",
        },
      });
      await writeAudit(
        {
          action: "FeeChargeRecorded",
          listingId,
          details: { chargeId: charge.id, orderGid },
        },
        { tx },
      );
    });
  } catch (error) {
    if (error?.code !== "P2002") throw error;
  }

  const fulfilmentError = await fulfil(orderGid, { admin });

  // Never caught: a rejection means "try again" (F01-FIX-1), and the webhook answers 500.
  await publish(EVENTS.PaymentReceived, {
    listingId,
    orderGid,
    billingMode: "ONE_MONTH",
  });

  // A publish that resolves doesn't mean the listing is live. When it isn't, core has set
  // `refundFlag` and written `PaymentNotApplied`.
  const after = await loadPayable(listingId);
  if (after?.liveAt) await ensurePeriod(listingId, orderGid);
  else
    await reportPaymentProblem(
      `late-payment:${orderGid}`,
      "A listing fee was paid but the listing could not go live. A refund may be due.",
      { orderGid, status: after?.status ?? null },
      { listingId },
    );

  const others = await prisma.feeCharge.count({
    where: {
      listingId,
      kind: "INITIAL",
      status: "PAID",
      orderGid: { not: orderGid },
    },
  });
  if (others > 0)
    await reportPaymentProblem(
      `duplicate-fee-order:${listingId}`,
      "A listing fee was paid more than once. A refund may be due.",
      { orderGid, otherCharges: others },
      { listingId },
    );

  if (fulfilmentError) {
    await reportPaymentProblem(
      `fee-order-unfulfilled:${orderGid}`,
      "A fee order could not be marked as fulfilled.",
      {
        orderGid,
        code: fulfilmentError?.code ?? fulfilmentError?.name ?? "Error",
      },
      { listingId },
    );
    // The listing is live; the retry only has the fulfilment left to do.
    throw fulfilmentError;
  }
}
