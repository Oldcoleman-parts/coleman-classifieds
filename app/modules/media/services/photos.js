// What sellers and staff do with stored photos: look at them, reorder them, pick the main
// one and delete them.
import { GetObjectCommand } from "@aws-sdk/client-s3";
import prisma from "@/db.server";
import {
  NotFoundError,
  requireId,
  ValidationError,
  writeAudit,
} from "@/modules/core/index.js";
import { mediaConfig, presign } from "./aws-clients.js";
import { requirePhotoId } from "./keys.js";
import { URL_TTL_SECONDS } from "./limits.js";
import { unpublishOne } from "./publish.js";
import { deleteObjects } from "./store.js";
import { requireOpenListing, requirePhotoActor } from "./uploads.js";

/**
 * @typedef {object} PhotoView
 * @property {string} id
 * @property {number} position 0 is the main photo
 * @property {boolean} isMain
 * @property {number | null} width
 * @property {number | null} height
 * @property {boolean} approved staff approved it; only approved photos are published
 * @property {boolean} published
 * @property {string} previewUrl a private link that works for ten minutes
 */

/** @param {string} listingId */
const currentPhotos = (listingId, db = prisma) =>
  db.photo.findMany({
    where: { listingId, deletedAt: null },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });

/**
 * A listing's photos for the seller's and staff's own screens, main photo first. The preview
 * links are private and short-lived: never put them on a public page.
 * @param {string} listingId a listing the caller has checked this person may see
 * @returns {Promise<PhotoView[]>}
 */
export async function listPhotos(listingId) {
  const photos = await currentPhotos(requireId(listingId, "listingId"));
  const { bucket } = mediaConfig();
  return Promise.all(
    photos.map(async (photo, index) => ({
      id: photo.id,
      position: index,
      isMain: index === 0,
      width: photo.width,
      height: photo.height,
      approved: photo.approvedAt !== null,
      published: photo.publicKeyBase !== null,
      previewUrl: await presign(
        new GetObjectCommand({ Bucket: bucket, Key: photo.privateKey }),
        { expiresIn: URL_TTL_SECONDS },
      ),
    })),
  );
}

/**
 * Put a listing's photos in a new order. The first one is the main photo.
 * @param {string} listingId
 * @param {string[]} photoIds every current photo of the listing, once each
 * @param {import("@/modules/core/types.js").ActorRef} actor the seller or staff
 * @returns {Promise<void>}
 * @throws {ValidationError} when the list isn't exactly the listing's photos
 */
export async function reorder(listingId, photoIds, actor) {
  const who = requirePhotoActor(actor);
  const id = await requireOpenListing(listingId);
  const wanted = Array.isArray(photoIds) ? photoIds.map(requirePhotoId) : [];
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
    const current = (await currentPhotos(id, tx)).map((photo) => photo.id);
    const same =
      wanted.length === current.length &&
      new Set(wanted).size === wanted.length &&
      wanted.every((photoId) => current.includes(photoId));
    if (!same)
      throw new ValidationError("photoIds don't match the listing's photos", {
        photoIds: "must list every photo of the listing once",
      });
    if (wanted.every((photoId, index) => photoId === current[index])) return;
    for (const [position, photoId] of wanted.entries())
      await tx.photo.update({ where: { id: photoId }, data: { position } });
    await writeAudit(
      { action: "PhotosReordered", actor: who, listingId: id },
      { tx },
    );
  });
}

/**
 * Make one photo the main photo; the others keep their order.
 * @param {string} listingId
 * @param {string} photoId
 * @param {import("@/modules/core/types.js").ActorRef} actor the seller or staff
 * @returns {Promise<void>}
 * @throws {NotFoundError} when the listing has no such photo
 */
export async function setMain(listingId, photoId, actor) {
  const main = requirePhotoId(photoId);
  const current = (await currentPhotos(requireId(listingId, "listingId"))).map(
    (photo) => photo.id,
  );
  if (!current.includes(main)) throw new NotFoundError("Photo not found");
  await reorder(
    listingId,
    [main, ...current.filter((each) => each !== main)],
    actor,
  );
}

/**
 * Delete a photo. It is taken off the public site first (if it was there), then its stored
 * file is removed for good. Deleting an already deleted photo does nothing.
 * @param {string} listingId
 * @param {string} photoId
 * @param {import("@/modules/core/types.js").ActorRef} actor the seller or staff
 * @returns {Promise<void>}
 * @throws {NotFoundError} when the listing has no such photo
 */
export async function deletePhoto(listingId, photoId, actor) {
  const who = requirePhotoActor(actor);
  const id = requireId(listingId, "listingId");
  const photo = await prisma.photo.findUnique({
    where: { id: requirePhotoId(photoId) },
  });
  if (!photo || photo.listingId !== id)
    throw new NotFoundError("Photo not found");
  if (photo.deletedAt) return;

  await unpublishOne(photo.id);
  // DECISION: the stored file is removed at once, so `deletedAt` always means it is gone.
  await deleteObjects([photo.privateKey]);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
    const { count } = await tx.photo.updateMany({
      where: { id: photo.id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (count === 0) return;
    // Close the gap, so positions stay 0, 1, 2…
    for (const [position, each] of (await currentPhotos(id, tx)).entries())
      if (each.position !== position)
        await tx.photo.update({ where: { id: each.id }, data: { position } });
    await writeAudit(
      {
        action: "PhotoDeleted",
        actor: who,
        listingId: id,
        details: { photoId: photo.id },
      },
      { tx },
    );
  });
}
