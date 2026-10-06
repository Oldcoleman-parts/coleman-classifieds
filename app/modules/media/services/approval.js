// Which photos staff have approved. Only approved photos are ever published (F03-FIX-2).
import prisma from "@/db.server";
import { requireId } from "@/modules/core/index.js";
import { requirePhotoId } from "./keys.js";

/**
 * Mark photos as approved by staff. Ids of another listing's photos, deleted photos or photos
 * that are already approved are ignored, so a repeated event changes nothing.
 * @param {string} listingId
 * @param {string[]} photoIds the photos staff approved (from `ListingApproved` / `RevisionApproved`)
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{ approved: number }>}
 */
export async function approvePhotos(
  listingId,
  photoIds,
  { now = new Date() } = {},
) {
  const id = requireId(listingId, "listingId");
  const ids = photoIds.map(requirePhotoId);
  if (ids.length === 0) return { approved: 0 };
  const { count } = await prisma.photo.updateMany({
    where: {
      listingId: id,
      id: { in: ids },
      deletedAt: null,
      approvedAt: null,
    },
    data: { approvedAt: now },
  });
  return { approved: count };
}
