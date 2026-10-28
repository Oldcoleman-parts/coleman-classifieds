// The records purge (F08-T4): a listing's buyer messages, inside the purge transaction ops runs.
import { requireId } from "@/modules/core/index.js";

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {string} listingId
 * @returns {Promise<number>}
 */
export async function purgeListingMessages(tx, listingId) {
  const { count } = await tx.buyerMessage.deleteMany({
    where: { listingId: requireId(listingId, "listingId") },
  });
  return count;
}
