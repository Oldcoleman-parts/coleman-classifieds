// The seller's photo actions, with the rules for each listing status. Media stores and
// publishes the photos; it trusts the listing id it is given, so every check is made here.
import prisma from "@/db.server";
import {
  ConflictError,
  EVENTS,
  publish,
  requireIdList,
} from "@/modules/core/index.js";
import {
  completeUpload,
  createUploadUrl,
  deletePhoto,
  listPhotos,
  MediaNotConfiguredError,
  reorder,
} from "@/modules/media/index.js";

const EDITABLE = ["DRAFT", "CHANGES_REQUESTED"];

/**
 * The PENDING revision of a listing, if any.
 * @param {string} listingId
 */
export const pendingRevision = (listingId) =>
  prisma.listingRevision.findFirst({
    where: { listingId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });

/**
 * The listing's photos for the seller's own page. Their preview links are private.
 * @param {string} listingId
 * @returns {Promise<{ photos: Array<{ id: string, isMain: boolean, approved: boolean, published: boolean, previewUrl: string }>, available: boolean }>}
 *   `available` is false when photo storage isn't configured
 */
export async function photosFor(listingId) {
  try {
    return { photos: await listPhotos(listingId), available: true };
  } catch (error) {
    if (error instanceof MediaNotConfiguredError)
      return { photos: [], available: false };
    throw error;
  }
}

/**
 * DECISION (F04-T2): photos can be added while the listing is being prepared or corrected,
 * and while it is live (they wait for a revision). They can't be added while staff review it,
 * while it awaits payment, or while it is paused, because nothing would ever approve them.
 * While a revision is pending, a live listing takes no new photos until staff decide.
 * @param {{ id: string, status: string }} listing
 */
async function requireCanAdd(listing) {
  if (EDITABLE.includes(listing.status)) return;
  if (listing.status === "LIVE") {
    if (await pendingRevision(listing.id))
      throw new ConflictError(
        "Your last changes are with staff. You can add photos once they’ve been reviewed.",
      );
    return;
  }
  throw new ConflictError("Photos can’t be changed at this stage.");
}

/**
 * @param {{ id: string, status: string }} listing
 * @param {{ contentType: unknown, byteSize: unknown }} input
 * @param {import("@/modules/core/types.js").ActorRef} actor
 */
export async function startUpload(listing, { contentType, byteSize }, actor) {
  await requireCanAdd(listing);
  return createUploadUrl({
    listingId: listing.id,
    actor,
    contentType,
    byteSize,
  });
}

/**
 * @param {{ id: string, status: string }} listing
 * @param {unknown} photoId
 * @param {import("@/modules/core/types.js").ActorRef} actor
 * @returns {Promise<{ id: string, approved: boolean }>}
 */
export async function finishUpload(listing, photoId, actor) {
  await requireCanAdd(listing);
  const photo = await completeUpload({
    listingId: listing.id,
    photoId,
    actor,
  });
  return { id: photo.id, approved: photo.approvedAt !== null };
}

/**
 * Delete a photo. On a live listing this is an immediate change: an approved photo leaves the
 * public page at once, but the last approved photo can't go, and nor can a photo waiting in a
 * revision (staff are looking at it).
 * @param {{ id: string, status: string }} listing
 * @param {unknown} photoId
 * @param {import("@/modules/core/types.js").ActorRef} actor
 */
export async function removePhoto(listing, photoId, actor) {
  if (EDITABLE.includes(listing.status))
    return deletePhoto(listing.id, photoId, actor);
  if (listing.status !== "LIVE")
    throw new ConflictError("Photos can’t be changed at this stage.");

  const { photos } = await photosFor(listing.id);
  const photo = photos.find((each) => each.id === photoId);
  if (!photo) return deletePhoto(listing.id, photoId, actor); // media answers "not found"
  const pending = await pendingRevision(listing.id);
  if (pending?.photoIds.includes(photo.id))
    throw new ConflictError(
      "This photo is waiting for staff review. You can remove it once it’s been reviewed.",
    );
  if (photo.approved && photos.filter((each) => each.approved).length === 1)
    throw new ConflictError(
      "Your listing needs at least one photo. Add another and have it approved first.",
    );
  await deletePhoto(listing.id, photo.id, actor);
  if (photo.approved)
    await publish(
      EVENTS.ListingUpdatedImmediate,
      { listingId: listing.id, fields: ["photos"] },
      { actor },
    );
}

/**
 * @param {{ id: string, status: string }} listing
 * @param {unknown} photoIds
 * @param {import("@/modules/core/types.js").ActorRef} actor
 */
export async function reorderPhotos(listing, photoIds, actor) {
  // DECISION: the order is part of what staff review, so it changes only before submission.
  if (!EDITABLE.includes(listing.status))
    throw new ConflictError("Photos can’t be reordered at this stage.");
  return reorder(listing.id, requireIdList(photoIds, "photoIds"), actor);
}
