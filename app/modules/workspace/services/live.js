// Changes to a live listing. Price, quantity and the availability note change at once; title,
// description and new photos go to staff as a revision while the approved version stays live.
// No path adds or replaces the merchandise itself.
import prisma from "@/db.server";
import {
  ConflictError,
  EVENTS,
  InvalidTransitionError,
  LISTING_EVENTS,
  publish,
  transition,
  ValidationError,
} from "@/modules/core/index.js";
import { cleanImmediate, cleanRevision } from "./fields.js";
import { photosFor } from "./photos.js";

const IMMEDIATE = ["askingPriceCents", "quantityAvailable", "availabilityNote"];
// The names `ListingUpdatedImmediate.fields` uses (docs/architecture/events.md).
const EVENT_FIELD = {
  askingPriceCents: "askingPrice",
  quantityAvailable: "quantityAvailable",
  availabilityNote: "availabilityNote",
};

/**
 * Update price, quantity and availability note. Publishes `ListingUpdatedImmediate` with the
 * fields that changed (nothing when none did).
 * @param {object} listing the current row
 * @param {FormData} form
 * @param {import("@/modules/core/types.js").ActorRef} actor
 * @returns {Promise<string[]>} the changed fields
 * @throws {ValidationError | InvalidTransitionError}
 */
export async function updateImmediate(listing, form, actor) {
  const values = cleanImmediate(form);
  const changed = IMMEDIATE.filter((field) => values[field] !== listing[field]);
  if (changed.length === 0) return [];
  const { count } = await prisma.listing.updateMany({
    where: { id: listing.id, status: "LIVE" },
    data: Object.fromEntries(changed.map((field) => [field, values[field]])),
  });
  if (count === 0)
    throw new InvalidTransitionError("This listing isn’t live now");
  const fields = changed.map((field) => EVENT_FIELD[field]);
  await publish(
    EVENTS.ListingUpdatedImmediate,
    { listingId: listing.id, fields },
    { actor },
  );
  return fields;
}

/**
 * Send title, description and new photo changes to staff. The revision holds only what differs
 * from the live listing; its photos are the seller's photos not yet approved, worked out here.
 * One revision at a time.
 * @param {object} listing the current row
 * @param {FormData} form
 * @param {import("@/modules/core/types.js").ActorRef} actor
 * @returns {Promise<{ id: string }>} the revision
 * @throws {ValidationError | ConflictError | InvalidTransitionError}
 */
export async function submitRevision(listing, form, actor) {
  const values = cleanRevision(form);
  const changes = Object.fromEntries(
    Object.entries(values).filter(([field, value]) => value !== listing[field]),
  );
  const { photos } = await photosFor(listing.id);
  const photoIds = photos
    .filter((photo) => !photo.approved)
    .map((photo) => photo.id);
  if (Object.keys(changes).length === 0 && photoIds.length === 0)
    throw new ValidationError("Nothing to send", {
      revision: "change the title or description, or add a photo, first",
    });

  const revision = await prisma.$transaction(async (tx) => {
    // One revision at a time, even when two requests arrive together.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`revision:${listing.id}`}))`;
    const current = await tx.listing.findUnique({
      where: { id: listing.id },
      select: { status: true },
    });
    if (current?.status !== "LIVE")
      throw new InvalidTransitionError("This listing isn’t live now");
    const pending = await tx.listingRevision.count({
      where: { listingId: listing.id, status: "PENDING" },
    });
    if (pending > 0)
      throw new ConflictError(
        "Your last changes are still with staff. You can send more once they’ve been reviewed.",
      );
    return tx.listingRevision.create({
      data: { listingId: listing.id, changes, photoIds },
      select: { id: true },
    });
  });
  await publish(
    EVENTS.RevisionSubmitted,
    { listingId: listing.id, revisionId: revision.id },
    { actor },
  );
  return revision;
}

const CLOSE_EVENTS = {
  sold: LISTING_EVENTS.MARK_SOLD,
  remove: LISTING_EVENTS.REMOVE,
};

/**
 * Mark the item sold or take the listing down. The listing closes for good.
 * @param {{ id: string }} listing
 * @param {"sold" | "remove"} kind
 * @param {import("@/modules/core/types.js").ActorRef} actor
 * @throws {InvalidTransitionError} unless the listing is live or paused
 */
export function closeListing(listing, kind, actor) {
  return transition(listing.id, CLOSE_EVENTS[kind], actor);
}
