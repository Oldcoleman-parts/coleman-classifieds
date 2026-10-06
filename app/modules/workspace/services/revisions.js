// Staff decisions on a live listing's revision. Core records the decision (APPROVE_REVISION /
// REJECT_REVISION); these listeners apply it to the listing. Both are safe to repeat.
import prisma from "@/db.server";
import { NotFoundError } from "@/modules/core/index.js";
import { deletePhoto, listPhotos } from "@/modules/media/index.js";
import { cleanRevisionChanges } from "./fields.js";

/**
 * DECISION (F04-FIX-1): only a staff decision applies (core allows only STAFF; this is a second
 * line of defence). `decidedBy` is the staff email from the event.
 * @param {{ actor?: { type: string, ref?: string } } | undefined} meta
 */
const staffOf = (meta) => (meta?.actor?.type === "STAFF" ? meta.actor : null);

/**
 * Mark a PENDING revision of this listing as decided. Nothing happens for a revision of another
 * listing or one already decided, so a repeated event changes nothing.
 * @returns {Promise<boolean>} whether this call decided it
 */
async function decide(tx, { listingId, revisionId }, status, staff, now) {
  const { count } = await tx.listingRevision.updateMany({
    where: { id: revisionId, listingId, status: "PENDING" },
    data: { status, decidedAt: now, decidedBy: staff.ref ?? null },
  });
  return count > 0;
}

/**
 * `RevisionApproved`: copy the revision's title and description into the listing, in the same
 * transaction as marking it APPROVED. Media approves and publishes its photos.
 * DECISION: changes that fail the field rules are not applied and the revision stays PENDING
 * (staff can approve again); nothing unchecked reaches the listing.
 * @param {{ listingId: string, revisionId: string }} payload
 * @param {{ actor?: object }} meta
 * @param {{ now?: Date }} [options]
 * @returns {Promise<boolean>} whether the listing was changed by this call
 */
export async function applyApproval(payload, meta, { now = new Date() } = {}) {
  const staff = staffOf(meta);
  if (!staff) return false;
  return prisma.$transaction(async (tx) => {
    const revision = await tx.listingRevision.findFirst({
      where: { id: payload.revisionId, listingId: payload.listingId },
    });
    if (revision?.status !== "PENDING") return false;
    const changes = cleanRevisionChanges(revision.changes);
    if (!(await decide(tx, payload, "APPROVED", staff, now))) return false;
    if (Object.keys(changes).length > 0)
      await tx.listing.update({
        where: { id: payload.listingId },
        data: changes,
      });
    return true;
  });
}

/**
 * `RevisionRejected`: mark the revision REJECTED and delete its photos to free the slots.
 * DECISION: only photos that were never approved are deleted, so a live photo is never lost.
 * The deletes run again on a repeated event, which retries any that failed; `deletePhoto`
 * skips photos already deleted. The deciding staff member is the photo actor (media refuses
 * SYSTEM), so the `PhotoDeleted` audit names them.
 * @param {{ listingId: string, revisionId: string }} payload
 * @param {{ actor?: object }} meta
 * @param {{ now?: Date }} [options]
 * @returns {Promise<number>} photos deleted by this call
 */
export async function applyRejection(payload, meta, { now = new Date() } = {}) {
  const staff = staffOf(meta);
  if (!staff) return 0;
  const revision = await prisma.$transaction(async (tx) => {
    await decide(tx, payload, "REJECTED", staff, now);
    return tx.listingRevision.findFirst({
      where: { id: payload.revisionId, listingId: payload.listingId },
    });
  });
  if (revision?.status !== "REJECTED" || revision.photoIds.length === 0)
    return 0;

  const current = await listPhotos(payload.listingId);
  const unapproved = current
    .filter((photo) => !photo.approved && revision.photoIds.includes(photo.id))
    .map((photo) => photo.id);
  let deleted = 0;
  for (const photoId of unapproved) {
    try {
      await deletePhoto(payload.listingId, photoId, staff);
      deleted += 1;
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  return deleted;
}
