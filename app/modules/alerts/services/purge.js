// The records purge (F08-T4): a listing's alert queue row (no FK, so it would outlive the
// listing), inside the purge transaction ops runs.
import { requireId } from "@/modules/core/index.js";

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {string} listingId
 * @returns {Promise<number>}
 */
export async function purgeListingAlert(tx, listingId) {
  const { count } = await tx.alertQueue.deleteMany({
    where: { listingId: requireId(listingId, "listingId") },
  });
  return count;
}
