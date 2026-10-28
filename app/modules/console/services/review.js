// The review screen (`/app/listings/:id`): what buyers would see, the private seller details,
// the photos, a waiting change and the payment record, plus which actions are allowed now.
import prisma from "@/db.server";
import {
  canTransition,
  getSettings,
  LISTING_EVENTS,
  requireId,
  ValidationError,
} from "@/modules/core/index.js";
import { listPhotos, MediaNotConfiguredError } from "@/modules/media/index.js";
import { loadListingHistory } from "./history.js";

const STAFF = { type: "STAFF" };
// DECISION D1 (F05-T1): staff change the photo set (upload, order, main photo) only while
// the listing is being reviewed. Deleting a photo is allowed until the listing closes.
export const PHOTO_EDIT_STATUSES = ["SUBMITTED"];
export const PHOTO_DELETE_STATUSES = [
  "SUBMITTED",
  "APPROVED_AWAITING_PAYMENT",
  "LIVE",
  "PAUSED",
];
const ACTIONS = [
  "APPROVE",
  "REQUEST_CHANGES",
  "REJECT",
  "PAUSE",
  "RESUME",
  "EXTEND",
];

/** @param {Date | null} date */
const iso = (date) => date?.toISOString() ?? null;

/**
 * The listing with its seller, or null.
 * @param {string} listingId
 */
export function findListing(listingId) {
  return prisma.listing.findUnique({
    where: { id: requireId(listingId, "listingId") },
    include: { invitation: true },
  });
}

/**
 * The listing's waiting change, if any.
 * @param {string} listingId
 */
export function findPendingRevision(listingId) {
  return prisma.listingRevision.findFirst({
    where: { listingId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Photos for staff, or null where photo storage isn't set up.
 * @param {string} listingId
 */
async function photosFor(listingId) {
  try {
    return (await listPhotos(listingId)).map(
      ({ id, isMain, previewUrl, approved, published }) => ({
        id,
        isMain,
        previewUrl,
        approved,
        published,
      }),
    );
  } catch (error) {
    if (error instanceof MediaNotConfiguredError) return null;
    throw error;
  }
}

/**
 * Everything the review screen shows. Seller details and photo links are private: they
 * appear only on this admin screen.
 * @param {string} listingId
 */
export async function loadReviewScreen(listingId) {
  let listing;
  try {
    listing = await findListing(listingId);
  } catch (error) {
    if (error instanceof ValidationError) return null;
    throw error;
  }
  if (!listing) return null;
  const { invitation } = listing;

  const [revision, photos, charges, periods, adjustments, settings, history] =
    await Promise.all([
      findPendingRevision(listing.id),
      photosFor(listing.id),
      prisma.feeCharge.findMany({
        where: { listingId: listing.id },
        orderBy: { createdAt: "asc" },
      }),
      prisma.listingPeriod.findMany({
        where: { listingId: listing.id },
        orderBy: { startsAt: "asc" },
      }),
      prisma.listingTimeAdjustment.findMany({
        where: { listingId: listing.id },
        orderBy: { at: "asc" },
      }),
      getSettings(),
      loadListingHistory(listing.id),
    ]);

  const allowed = Object.fromEntries(
    ACTIONS.map((event) => [
      event,
      canTransition(listing, LISTING_EVENTS[event], STAFF),
    ]),
  );
  // Core decides revisions only on a LIVE listing (DECISION D4: a paused one waits).
  const canDecideRevision = Boolean(revision) && listing.status === "LIVE";
  const changes = revision?.changes ?? {};

  return {
    id: listing.id,
    status: listing.status,
    preview: {
      title: listing.title,
      description: listing.description,
      askingPriceCents: listing.askingPriceCents,
      quantityAvailable: listing.quantityAvailable,
      availabilityNote: listing.availabilityNote,
      condition: listing.condition,
      knownIssues: listing.knownIssues,
      contents: listing.contents,
      city: listing.city,
      state: listing.state,
      arrangements: listing.arrangements,
      arrangementsNote: listing.arrangementsNote,
      sellerDisplay: listing.sellerDisplay,
    },
    seller: {
      name: invitation.sellerName,
      email: invitation.sellerEmail,
      phone: invitation.sellerPhone,
      itemSummary: invitation.itemSummary,
      invitationId: invitation.id,
      invitationStatus: invitation.status,
      feeOfferedCents: invitation.feeOfferedCents,
      feeRegularCents: invitation.feeRegularCents,
    },
    dates: {
      draftDueBy: iso(listing.draftDueBy),
      correctionDueBy: iso(listing.correctionDueBy),
      paymentDueBy: iso(listing.paymentDueBy),
      liveAt: iso(listing.liveAt),
      expiresAt: iso(listing.expiresAt),
      pausedAt: iso(listing.pausedAt),
      closedAt: iso(listing.closedAt),
    },
    // DECISION D2 (F05-T1): the correction deadline comes from Settings; staff don't pick it.
    correctionWindowDays: settings.correctionWindowDays,
    pauseReason: listing.pauseReason,
    closedReason: listing.closedReason,
    photos,
    history,
    revision: revision && {
      id: revision.id,
      createdAt: iso(revision.createdAt),
      before: { title: listing.title, description: listing.description },
      after: {
        title: changes.title ?? null,
        description: changes.description ?? null,
      },
      photoIds: revision.photoIds,
    },
    actions: {
      approve: allowed.APPROVE,
      requestChanges: allowed.REQUEST_CHANGES,
      reject: allowed.REJECT,
      pause: allowed.PAUSE,
      resume: allowed.RESUME,
      extend: allowed.EXTEND && listing.expiresAt !== null,
      decideRevision: canDecideRevision,
      editWording: listing.status === "SUBMITTED",
      editPhotos: PHOTO_EDIT_STATUSES.includes(listing.status),
      deletePhotos: PHOTO_DELETE_STATUSES.includes(listing.status),
    },
    payments: {
      charges: charges.map((charge) => ({
        id: charge.id,
        kind: charge.kind,
        amountCents: charge.amountCents,
        status: charge.status,
        createdAt: iso(charge.createdAt),
      })),
      periods: periods.map((period) => ({
        id: period.id,
        startsAt: iso(period.startsAt),
        endsAt: iso(period.endsAt),
      })),
      adjustments: adjustments.map((adjustment) => ({
        id: adjustment.id,
        type: adjustment.type,
        minutes: adjustment.minutes,
        reason: adjustment.reason,
        staff: adjustment.staff,
        at: iso(adjustment.at),
      })),
    },
  };
}
