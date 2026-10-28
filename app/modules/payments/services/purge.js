// The records purge (F08-T4): a listing's periods and fee charges, inside the purge
// transaction ops runs.
import { requireId } from "@/modules/core/index.js";

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {string} listingId
 * @returns {Promise<{ periods: number, charges: number }>}
 */
export async function purgeListingPayments(tx, listingId) {
  const id = requireId(listingId, "listingId");
  const periods = await tx.listingPeriod.deleteMany({
    where: { listingId: id },
  });
  const charges = await tx.feeCharge.deleteMany({ where: { listingId: id } });
  return { periods: periods.count, charges: charges.count };
}
