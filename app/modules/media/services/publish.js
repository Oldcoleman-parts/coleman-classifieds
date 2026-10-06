// Making photos public and taking them down again. Public copies live under `public/` with
// random names and are served only through CloudFront. Every function is safe to repeat.
import { CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import prisma from "@/db.server";
import {
  getListingSummary,
  requireId,
  TERMINAL_STATUSES,
} from "@/modules/core/index.js";
import { getCloudFrontClient, mediaConfig } from "./aws-clients.js";
import {
  newPublicBase,
  publicUrl,
  requirePhotoId,
  variantKey,
  variantKeys,
} from "./keys.js";
import { makeVariants } from "./process.js";
import { deleteObjects, readObject, writeJpeg } from "./store.js";

// A public copy never changes: a republished photo gets a new name.
const PUBLIC_CACHE = "public, max-age=31536000, immutable";

/**
 * Ask CloudFront to forget its copies. Cached files are otherwise served after deletion.
 * @param {string[]} paths starting with "/"; may end in "*"
 */
async function invalidate(paths) {
  await getCloudFrontClient().send(
    new CreateInvalidationCommand({
      DistributionId: mediaConfig().distributionId,
      InvalidationBatch: {
        CallerReference: `${Date.now()}-${paths.length}-${Math.random().toString(36).slice(2)}`,
        Paths: { Quantity: paths.length, Items: paths },
      },
    }),
  );
}

/**
 * Is the listing closed (or gone)? A closed listing's photos are never public.
 * @param {string} listingId
 * @returns {Promise<boolean>}
 */
export async function isClosed(listingId) {
  const listing = await getListingSummary(listingId);
  return !listing || TERMINAL_STATUSES.includes(listing.status);
}

/**
 * The public addresses of a listing's approved, published photos, main photo first.
 * @param {string} listingId
 * @param {"thumb" | "medium" | "large"} [size]
 * @returns {Promise<string[]>} CloudFront addresses only
 */
export async function getPublicUrls(listingId, size = "large") {
  const photos = await prisma.photo.findMany({
    where: {
      listingId: requireId(listingId, "listingId"),
      deletedAt: null,
      approvedAt: { not: null },
      publicKeyBase: { not: null },
    },
    orderBy: { position: "asc" },
  });
  return photos.map((photo) => publicUrl(photo.publicKeyBase, size));
}

/**
 * Make a listing's approved photos public. Photos that are already public are left as they
 * are; photos staff haven't approved are never published. A closed listing publishes nothing.
 * @param {string} listingId
 * @returns {Promise<string[]>} the `_large` addresses of every published photo, main first;
 *   empty for a closed listing
 * @throws when a photo can't be published; the ones before it stay published and a repeat
 *   call carries on from there
 */
export async function publish(listingId) {
  const id = requireId(listingId, "listingId");
  // DECISION (F03-FIX-2): a closed listing is skipped, not an error, so a late event is harmless.
  if (await isClosed(id)) {
    console.error(`[media] publish skipped: listing ${id} is closed`);
    return [];
  }
  const photos = await prisma.photo.findMany({
    where: {
      listingId: id,
      deletedAt: null,
      approvedAt: { not: null },
      publicKeyBase: null,
    },
    orderBy: { position: "asc" },
  });
  for (const photo of photos) {
    const original = await readObject(photo.privateKey);
    if (!original) {
      console.error(`[media] photo ${photo.id} has no stored file`);
      throw new Error("A photo could not be published");
    }
    const base = newPublicBase(id);
    const variants = await makeVariants(original);
    await Promise.all(
      Object.entries(variants).map(([size, body]) =>
        writeJpeg(variantKey(base, size), body, { cacheControl: PUBLIC_CACHE }),
      ),
    );
    const { count } = await prisma.photo.updateMany({
      where: { id: photo.id, publicKeyBase: null, deletedAt: null },
      data: { publicKeyBase: base },
    });
    // Published or deleted by another request in the meantime: these copies aren't needed.
    if (count === 0) {
      try {
        await deleteObjects(variantKeys(base));
      } catch (error) {
        // Unneeded copies under a random name no row points to: the other photos still
        // have to be published.
        console.error(
          `[media] publish cleanup failed: ${error?.name ?? "Error"}`,
        );
      }
    }
  }
  // Closed while we were publishing: take the copies down again (the hourly sweep is the backstop).
  if (await isClosed(id)) {
    await unpublish(id);
    return [];
  }
  return getPublicUrls(id);
}

/**
 * Take down every public photo of a listing. Does nothing when none is public.
 * @param {string} listingId
 * @returns {Promise<{ unpublished: number }>}
 */
export async function unpublish(listingId) {
  const id = requireId(listingId, "listingId");
  const photos = await prisma.photo.findMany({
    where: { listingId: id, publicKeyBase: { not: null } },
  });
  if (photos.length === 0) return { unpublished: 0 };
  // The row is cleared last, so a failure part-way is finished by the next call.
  await deleteObjects(
    photos.flatMap((photo) => variantKeys(photo.publicKeyBase)),
  );
  await invalidate([`/public/${id}/*`]);
  await prisma.photo.updateMany({
    where: { id: { in: photos.map((photo) => photo.id) } },
    data: { publicKeyBase: null },
  });
  return { unpublished: photos.length };
}

/**
 * Take down one photo straight away (a seller or staff removed it from a live listing).
 * @param {string} photoId
 * @returns {Promise<{ unpublished: number }>}
 */
export async function unpublishOne(photoId) {
  const photo = await prisma.photo.findUnique({
    where: { id: requirePhotoId(photoId) },
  });
  if (!photo?.publicKeyBase) return { unpublished: 0 };
  const keys = variantKeys(photo.publicKeyBase);
  await deleteObjects(keys);
  await invalidate(keys.map((key) => `/${key}`));
  await prisma.photo.updateMany({
    where: { id: photo.id, publicKeyBase: photo.publicKeyBase },
    data: { publicKeyBase: null },
  });
  return { unpublished: 1 };
}
