// The hourly backstop for `ListingClosed`: a closed listing whose public photos are still up
// (its handler failed, or it closed while photos were being published) is taken down here.
import prisma from "@/db.server";
import { writeAudit } from "@/modules/core/index.js";
import { isClosed, unpublish } from "./publish.js";

/**
 * Unpublish every closed listing that still has public photos. Safe to repeat: a cleaned
 * listing has no public photos left and isn't looked at again.
 * @returns {Promise<{ checked: number, listings: number, unpublished: number, failed: number }>}
 */
export async function unpublishClosed() {
  const withPublic = await prisma.photo.findMany({
    where: { publicKeyBase: { not: null } },
    distinct: ["listingId"],
    select: { listingId: true },
  });

  const result = { checked: 0, listings: 0, unpublished: 0, failed: 0 };
  for (const { listingId } of withPublic) {
    result.checked += 1;
    try {
      if (!(await isClosed(listingId))) continue;
      const { unpublished } = await unpublish(listingId);
      await writeAudit({
        action: "PhotosUnpublished",
        listingId,
        details: { count: unpublished, by: "sweep" },
      });
      result.listings += 1;
      result.unpublished += unpublished;
    } catch (error) {
      // One listing failing must not stop the others; the next run tries it again.
      result.failed += 1;
      console.error(
        `[media] sweep failed for listing ${listingId}: ${error?.name ?? "Error"}`,
      );
    }
  }
  return result;
}
