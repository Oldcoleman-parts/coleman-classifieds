// The `orders/paid` webhook. HMAC and the receipt are handled by `platform.handleWebhook()`.
// A delivery may run twice (F01-FIX-2), so every step checks before it writes.
// F06-FIX-2: the request only checks the order and records the charge, all in the database,
// so Shopify gets its answer quickly. `apply.js` does the rest after the reply.
import prisma from "@/db.server";
import { getSettings, writeAudit } from "@/modules/core/index.js";
import { startApply } from "./apply.js";
import { discountCodeFor } from "./discount.js";
import { loadPayable } from "./facts.js";
import { reportPaymentProblem } from "./incidents.js";
import { readOrder } from "./order-payload.js";

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
 * Check a paid order and record its charge. Nothing here calls Shopify, S3 or SES.
 * @param {FeeOrderFacts} order
 * @returns {Promise<{ chargeId: string, appliedAt: Date | null } | { mismatch: string } | null>}
 *   null when the order is not a fee order; `mismatch` when it doesn't match (the problem
 *   is recorded)
 */
export async function recordPaidOrder(order) {
  const { feeVariantGid } = await getSettings();
  const hasFeeLine =
    !!feeVariantGid &&
    order.lines.some((line) => line.variantGid === feeVariantGid);
  // An ordinary store order: nothing to do, and nothing is written.
  if (!order.hasAttribute && !hasFeeLine) return null;

  const { orderGid } = order;
  const payable = order.listingId ? await loadPayable(order.listingId) : null;
  const reason = mismatch(order, payable, feeVariantGid);
  if (reason) {
    // No charge is recorded and nothing is published. Staff decide (usually a refund).
    // DECISION (F06-FIX-2): a mismatched order is no longer fulfilled, so the request makes no
    // Shopify call; ShippingEasy already leaves out the fee SKU.
    const unmatched = ["NO_ATTRIBUTE", "UNKNOWN_LISTING"].includes(reason);
    await reportPaymentProblem(
      `${unmatched ? "unmatched-order" : "fee-mismatch"}:${orderGid}`,
      "A paid order doesn't match the listing fee it claims to pay.",
      { orderGid, reason },
      { listingId: payable?.id ?? null },
    );
    return { mismatch: reason };
  }
  const listingId = /** @type {Payable} */ (payable).id;

  // The charge is saved first; a retried delivery finds it and goes on.
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
  const charge = await prisma.feeCharge.findUnique({
    where: { orderGid },
    select: { id: true, appliedAt: true },
  });
  return charge && { chargeId: charge.id, appliedAt: charge.appliedAt };
}

/**
 * @param {{ payload: unknown }} delivery from `platform.handleWebhook()`
 * @returns {Promise<void>} resolves once the charge is recorded; a rejection (a database
 *   error) makes the webhook answer 500, so Shopify retries
 */
export async function handleOrderPaid({ payload }) {
  const order = readOrder(payload);
  if (!order) return;
  const recorded = await recordPaidOrder(order);
  // Not awaited: the webhook answers first. `payments.apply-paid-charges` is the backstop.
  if (recorded && "chargeId" in recorded && !recorded.appliedAt)
    void startApply(recorded.chargeId);
}
