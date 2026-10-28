// The `refunds/create` webhook: a refunded listing fee is marked and staff are told.
// DECISION (F06-T1): the listing itself is not touched. Whether a refunded listing stays
// live is a staff decision.
import prisma from "@/db.server";
import { writeAudit } from "@/modules/core/index.js";
import { reportPaymentProblem } from "./incidents.js";
import { readRefund } from "./order-payload.js";

/**
 * @param {{ payload: unknown }} delivery from `platform.handleWebhook()`
 * @returns {Promise<void>}
 */
export async function handleRefundCreated({ payload }) {
  const refund = readRefund(payload);
  if (!refund) return;
  const charge = await prisma.feeCharge.findUnique({
    where: { orderGid: refund.orderGid },
    select: { id: true, listingId: true },
  });
  // A refund of an ordinary store order.
  if (!charge) return;

  // One conditional update: a repeated delivery changes no row and reports nothing.
  const changed = await prisma.$transaction(async (tx) => {
    const { count } = await tx.feeCharge.updateMany({
      where: { id: charge.id, status: { not: "REFUNDED" } },
      data: { status: "REFUNDED" },
    });
    if (count === 1)
      await writeAudit(
        {
          action: "FeeRefunded",
          listingId: charge.listingId,
          details: { chargeId: charge.id, orderGid: refund.orderGid },
        },
        { tx },
      );
    return count === 1;
  });
  if (changed)
    await reportPaymentProblem(
      `fee-refund:${refund.orderGid}`,
      "A listing fee was refunded. Check whether the listing should stay live.",
      { orderGid: refund.orderGid },
      { listingId: charge.listingId },
    );
}
