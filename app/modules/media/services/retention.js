// The stored photos of a closed listing are kept for a while (90 days by default) and then
// deleted for good.
import prisma from "@/db.server";
import {
  getListingSummary,
  getSettings,
  writeAudit,
} from "@/modules/core/index.js";
import { variantKeys } from "./keys.js";
import { deleteObjects } from "./store.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Delete the photos of every listing that closed longer ago than the retention period.
 * Safe to repeat: a purged photo is marked deleted and isn't looked at again.
 * @param {{ now?: Date }} [context]
 * @returns {Promise<{ listings: number, purged: number }>}
 */
export async function runRetention({ now = new Date() } = {}) {
  const { photoRetentionDays } = await getSettings();
  const cutoff = now.getTime() - photoRetentionDays * DAY_MS;
  const withPhotos = await prisma.photo.findMany({
    where: { deletedAt: null },
    distinct: ["listingId"],
    select: { listingId: true },
  });

  let listings = 0;
  let purged = 0;
  for (const { listingId } of withPhotos) {
    const listing = await getListingSummary(listingId);
    if (!listing?.closedAt || listing.closedAt.getTime() > cutoff) continue;
    const photos = await prisma.photo.findMany({
      where: { listingId, deletedAt: null },
    });
    await deleteObjects(
      photos.flatMap((photo) => [
        photo.privateKey,
        // Public copies were removed at close; this only catches one that was missed.
        ...(photo.publicKeyBase ? variantKeys(photo.publicKeyBase) : []),
      ]),
    );
    await prisma.$transaction(async (tx) => {
      await tx.photo.updateMany({
        where: { id: { in: photos.map((photo) => photo.id) } },
        data: { deletedAt: now, publicKeyBase: null },
      });
      await writeAudit(
        {
          action: "PhotosPurged",
          listingId,
          details: { count: photos.length },
        },
        { tx },
      );
    });
    listings += 1;
    purged += photos.length;
  }
  return { listings, purged };
}
