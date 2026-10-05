// Uploading a photo, in two steps: the browser asks for a link and sends the file straight
// to `incoming/`; then the app cleans the file and keeps the result in `private/`.
import { PutObjectCommand } from "@aws-sdk/client-s3";
import prisma from "@/db.server";
import {
  ConflictError,
  ForbiddenActorError,
  getListingSummary,
  getSettings,
  NotFoundError,
  requireActor,
  requireEnum,
  requireId,
  requireInt,
  TERMINAL_STATUSES,
  ValidationError,
  writeAudit,
} from "@/modules/core/index.js";
import { mediaConfig, presign } from "./aws-clients.js";
import { incomingKey, newPhotoId, privateKey, requirePhotoId } from "./keys.js";
import { MAX_BYTES, UPLOAD_TYPES, URL_TTL_SECONDS } from "./limits.js";
import { processImage } from "./process.js";
import { deleteObjects, readObject, writeJpeg } from "./store.js";

const PHOTO_ACTORS = ["SELLER", "STAFF"];

/**
 * Who may add or change photos. The caller has already checked that this person may work
 * on this listing (the seller's link in F04, the staff session in F05).
 * @param {unknown} actor
 * @returns {import("@/modules/core/types.js").ActorRef}
 */
export function requirePhotoActor(actor) {
  const who = requireActor(actor);
  if (!PHOTO_ACTORS.includes(who.type))
    throw new ForbiddenActorError("Only the seller or staff can change photos");
  return who;
}

/**
 * @param {unknown} listingId
 * @returns {Promise<string>} the id of a listing that can still take photo changes
 * @throws {NotFoundError | ConflictError}
 */
export async function requireOpenListing(listingId) {
  const id = requireId(listingId, "listingId");
  const listing = await getListingSummary(id);
  if (!listing) throw new NotFoundError("Listing not found");
  if (TERMINAL_STATUSES.includes(listing.status))
    throw new ConflictError("This listing is closed");
  return id;
}

/**
 * @param {number} maxPhotos
 * @returns {never}
 */
function tooMany(maxPhotos) {
  throw new ValidationError("Too many photos", {
    photos: `must be at most ${maxPhotos} photos`,
  });
}

/** @param {string} listingId */
const countPhotos = (listingId, db = prisma) =>
  db.photo.count({ where: { listingId, deletedAt: null } });

/**
 * A link the browser can upload one photo to. It works for ten minutes, for one object under
 * `incoming/<listingId>/`, and only for the stated type and size.
 * @param {object} input
 * @param {string} input.listingId a listing the caller has checked this person may edit
 * @param {import("@/modules/core/types.js").ActorRef} input.actor the seller or staff
 * @param {string} input.contentType
 * @param {number | string} input.byteSize
 * @returns {Promise<{ photoId: string, url: string, headers: Record<string, string>, expiresAt: string }>}
 *   send the file with PUT and exactly these headers, then call `completeUpload()`
 * @throws {ValidationError} for a wrong type, a file that is too big or a full listing
 */
export async function createUploadUrl({
  listingId,
  actor,
  contentType,
  byteSize,
}) {
  requirePhotoActor(actor);
  const type = requireEnum(contentType, UPLOAD_TYPES, "contentType");
  const size = requireInt(byteSize, "byteSize", { min: 1, max: MAX_BYTES });
  const id = await requireOpenListing(listingId);
  const { maxPhotos } = await getSettings();
  if ((await countPhotos(id)) >= maxPhotos) tooMany(maxPhotos);

  const photoId = newPhotoId();
  const url = await presign(
    new PutObjectCommand({
      Bucket: mediaConfig().bucket,
      Key: incomingKey(id, photoId),
      ContentType: type,
      ContentLength: size,
    }),
    {
      expiresIn: URL_TTL_SECONDS,
      // Both are part of the signature, so S3 refuses a different type or size.
      signableHeaders: new Set(["content-type", "content-length"]),
    },
  );
  return {
    photoId,
    url,
    headers: { "Content-Type": type },
    expiresAt: new Date(Date.now() + URL_TTL_SECONDS * 1000).toISOString(),
  };
}

/**
 * Turn an uploaded file into a stored photo: check what it really is, re-encode it as a
 * JPEG with no metadata, keep that in `private/` and remove the upload. Calling it again
 * for the same photo returns the same photo.
 * @param {object} input
 * @param {string} input.listingId a listing the caller has checked this person may edit
 * @param {string} input.photoId from `createUploadUrl()`
 * @param {import("@/modules/core/types.js").ActorRef} input.actor the seller or staff
 * @returns {Promise<import("@prisma/client").Photo>}
 * @throws {ValidationError} when the file is not an accepted photo or the listing is full
 * @throws {NotFoundError} when nothing was uploaded for this id
 */
export async function completeUpload({ listingId, photoId, actor }) {
  const who = requirePhotoActor(actor);
  const id = requireId(listingId, "listingId");
  const photo = requirePhotoId(photoId);

  const existing = await prisma.photo.findUnique({ where: { id: photo } });
  if (existing) {
    if (existing.listingId !== id || existing.deletedAt)
      throw new NotFoundError("Photo not found");
    return existing;
  }
  await requireOpenListing(id);

  const incoming = incomingKey(id, photo);
  const storedKey = privateKey(id, photo);
  let bytes;
  try {
    bytes = await readObject(incoming, { maxBytes: MAX_BYTES });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    await deleteObjects([incoming]);
    throw new ValidationError("photo is too large", { photo: "is too large" });
  }
  if (!bytes) throw new NotFoundError("Upload not found");

  let processed;
  try {
    processed = await processImage(bytes);
  } catch (error) {
    // A file that isn't a photo is removed straight away.
    if (error instanceof ValidationError) await deleteObjects([incoming]);
    throw error;
  }
  await writeJpeg(storedKey, processed.jpeg);

  const { maxPhotos } = await getSettings();
  let row;
  try {
    row = await prisma.$transaction(async (tx) => {
      // One upload at a time per listing, so two can't both take the last place.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const count = await countPhotos(id, tx);
      if (count >= maxPhotos) tooMany(maxPhotos);
      const created = await tx.photo.create({
        data: {
          id: photo,
          listingId: id,
          privateKey: storedKey,
          position: count,
          uploadedBy: who.type,
          width: processed.width,
          height: processed.height,
        },
      });
      await writeAudit(
        {
          action: "PhotoUploaded",
          actor: who,
          listingId: id,
          details: { photoId: photo },
        },
        { tx },
      );
      return created;
    });
  } catch (error) {
    // The same upload was completed by another request a moment ago.
    if (error?.code === "P2002")
      return prisma.photo.findUniqueOrThrow({ where: { id: photo } });
    await deleteObjects([storedKey, incoming]);
    throw error;
  }
  await deleteObjects([incoming]);
  return row;
}
