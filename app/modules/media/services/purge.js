// The records purge (F08-T4): a listing's photo rows go once every stored file is deleted
// (the 90-day `media.purge-closed-photos` task sets `deletedAt`). Ops runs the transaction.
import prisma from "@/db.server";
import {
  ConflictError,
  requireId,
  requireIdList,
} from "@/modules/core/index.js";

/**
 * The listings (of these, at most 500) that still have a photo not yet deleted from storage.
 * @param {string[]} listingIds
 * @returns {Promise<Set<string>>}
 */
export async function listingsWithStoredPhotos(listingIds) {
  const ids = requireIdList(listingIds, "listingIds", { max: 500 });
  if (ids.length === 0) return new Set();
  const rows = await prisma.photo.findMany({
    where: { listingId: { in: ids }, deletedAt: null },
    distinct: ["listingId"],
    select: { listingId: true },
  });
  return new Set(rows.map(({ listingId }) => listingId));
}

/**
 * Deletes a listing's photo rows inside the purge transaction. Refuses (and so rolls the
 * purge back) while a photo's files are still stored.
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {string} listingId
 * @returns {Promise<number>}
 */
export async function purgeListingPhotos(tx, listingId) {
  const id = requireId(listingId, "listingId");
  const stored = await tx.photo.count({
    where: { listingId: id, deletedAt: null },
  });
  if (stored > 0) throw new ConflictError("Photos are still stored");
  const { count } = await tx.photo.deleteMany({ where: { listingId: id } });
  return count;
}
