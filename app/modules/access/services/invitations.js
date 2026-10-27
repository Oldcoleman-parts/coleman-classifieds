// Staff invitations: one private link, one listing. The fee and offer scope are locked here.
import prisma from "@/db.server";
import {
  closeUnusedListing,
  ConflictError,
  dispatch,
  EVENTS,
  getSettings,
  isReleased,
  NotFoundError,
  optionalString,
  recordEvent,
  requireCents,
  requireEmail,
  requireEnum,
  requireId,
  requireIdList,
  requireStaff,
  requireString,
  ValidationError,
  writeAudit,
} from "@/modules/core/index.js";
import { hashSecret, newToken } from "./tokens.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const OFFER_SCOPES = ["FIRST_MONTH", "ALL_RENEWALS"];
const HOUR_MS = 60 * 60 * 1000;
const NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @typedef {object} InvitationInput
 * @property {string} sellerName
 * @property {string} sellerEmail
 * @property {string} [sellerPhone]
 * @property {string} itemSummary
 * @property {number | null} [feeOfferedCents] defaults to the promotional fee, else the base fee
 * @property {"FIRST_MONTH" | "ALL_RENEWALS"} [offerScope]
 */

/**
 * Create an invitation and its (INVITED) listing in one transaction.
 * @param {InvitationInput} input
 * @param {import("@/modules/core/types.js").ActorRef} actor staff only
 * @param {{ now?: Date, formNonce?: string }} [options] `formNonce` is the create form's
 *   one-time code: a second create with the same code returns the first invitation
 * @returns {Promise<{ invitation: object, listing: object, token: string | null,
 *   duplicate: boolean }>} the token is returned once and never stored: show it to staff,
 *   never log it. A duplicate has no token.
 */
export async function createInvitation(
  input,
  actor,
  { now = new Date(), formNonce } = {},
) {
  const staff = requireStaff(actor);
  if (
    formNonce !== undefined &&
    (typeof formNonce !== "string" || !NONCE.test(formNonce))
  )
    throw new ValidationError("The form has expired: reload it and try again", {
      formNonce: "is not valid",
    });
  const sellerName = requireString(input.sellerName, "sellerName", {
    max: 120,
  });
  const sellerEmail = requireEmail(input.sellerEmail, "sellerEmail");
  const sellerPhone = optionalString(input.sellerPhone, "sellerPhone", {
    max: 40,
  });
  const itemSummary = requireString(input.itemSummary, "itemSummary", {
    max: 300,
  });
  // DECISION: the renewal offer stays hidden until renewals are released (Phase 2).
  const offerScope = isReleased("renewals")
    ? requireEnum(input.offerScope ?? "FIRST_MONTH", OFFER_SCOPES, "offerScope")
    : "FIRST_MONTH";
  const token = newToken();

  const created = await prisma.$transaction(async (tx) => {
    // DECISION (F04-FIX-3): a double submit of the create form returns the first invitation, so
    // the seller gets one email. The form's one-time code is kept in the InvitationCreated audit
    // details and checked under a lock, which holds across instances without a schema change.
    if (formNonce) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invite-form:${formNonce}`}))`;
      const earlier = await tx.auditEvent.findFirst({
        where: {
          action: EVENTS.InvitationCreated,
          actorRef: staff.ref,
          at: { gte: new Date(now.getTime() - HOUR_MS) },
          details: { path: ["formNonce"], equals: formNonce },
        },
        select: { details: true },
      });
      const earlierId = earlier?.details?.invitationId;
      if (typeof earlierId === "string") {
        const invitation = await tx.invitation.findUnique({
          where: { id: earlierId },
          omit: { tokenHash: true },
          include: { listing: true },
        });
        if (invitation)
          return { invitation, listing: invitation.listing, event: null };
      }
    }
    const settings = await getSettings({ tx });
    // The regular fee always comes from Settings, never from the form.
    const feeRegularCents = settings.baseFeeCents;
    const offered =
      input.feeOfferedCents === undefined || input.feeOfferedCents === null
        ? (settings.promoFeeCents ?? settings.baseFeeCents)
        : requireCents(input.feeOfferedCents, "feeOfferedCents");
    // DECISION: the offered fee is between 1 cent and the regular fee.
    if (offered < 1 || offered > feeRegularCents)
      throw new ValidationError("The offered fee is out of range", {
        feeOfferedCents: "must be more than 0 and not above the listing fee",
      });
    const invitation = await tx.invitation.create({
      data: {
        tokenHash: hashSecret(token),
        sellerName,
        sellerEmail,
        sellerPhone,
        itemSummary,
        feeRegularCents,
        feeOfferedCents: offered,
        offerScope,
        expiresAt: new Date(now.getTime() + settings.inviteExpiryDays * DAY_MS),
        createdBy: staff.ref,
      },
    });
    // A new listing starts INVITED (the default); that is not a status change.
    const listing = await tx.listing.create({
      data: { invitationId: invitation.id, arrangements: [] },
    });
    // The audit row is written in this transaction; handlers run after the commit (F01-FIX-4).
    const event = await recordEvent(
      tx,
      EVENTS.InvitationCreated,
      { invitationId: invitation.id, listingId: listing.id },
      {
        actor: staff,
        listingId: listing.id,
        details: formNonce ? { formNonce } : undefined,
      },
    );
    return { invitation, listing, event };
  });

  if (!created.event)
    return {
      invitation: created.invitation,
      listing: created.listing,
      token: null,
      duplicate: true,
    };
  await dispatch(created.event);
  return {
    invitation: created.invitation,
    listing: created.listing,
    token,
    duplicate: false,
  };
}

/**
 * Revoke an unused invitation. Once the seller has started, staff reject or remove instead.
 * @param {string} invitationId
 * @param {import("@/modules/core/types.js").ActorRef} actor staff only
 * @returns {Promise<boolean>} false when it was already revoked
 */
export async function revokeInvitation(invitationId, actor) {
  const staff = requireStaff(actor);
  const id = requireId(invitationId, "invitationId");
  const invitation = await prisma.invitation.findUnique({
    where: { id },
    include: { listing: { select: { id: true, status: true } } },
  });
  if (!invitation) throw new NotFoundError("Invitation not found");
  if (invitation.status === "REVOKED") return false;
  if (invitation.status !== "OPEN" || invitation.listing?.status !== "INVITED")
    throw new ConflictError(
      "Only an unused invitation can be revoked; reject or remove the listing instead",
    );
  // The link and the listing record close together; core writes the one audit entry (F01-FIX-3).
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.invitation.updateMany({
      where: { id, status: "OPEN" },
      data: { status: "REVOKED" },
    });
    if (count === 0) return false;
    await closeUnusedListing(
      invitation.listing.id,
      "INVITATION_REVOKED",
      staff,
      { tx },
    );
    return true;
  });
}

/**
 * Close the link of a listing that has ended (sold, removed, expired or rejected).
 * Safe to repeat.
 * @param {string} listingId
 * @returns {Promise<boolean>} true when the link was open and is now closed
 */
export async function closeInvitationForListing(listingId) {
  const listing = await prisma.listing.findUnique({
    where: { id: requireId(listingId, "listingId") },
    select: { invitationId: true },
  });
  if (!listing) return false;
  const { count } = await prisma.invitation.updateMany({
    where: { id: listing.invitationId, status: { in: ["OPEN", "USED"] } },
    data: { status: "CLOSED" },
  });
  if (count === 0) return false;
  await writeAudit({
    action: "InvitationClosed",
    listingId,
    details: { invitationId: listing.invitationId },
  });
  return true;
}

/**
 * Mark the link as used once the seller starts their draft (called by F04-T2 on OPEN).
 * @param {string} invitationId
 * @param {{ tx?: import("@prisma/client").Prisma.TransactionClient }} [options]
 */
export async function markInvitationUsed(invitationId, { tx } = {}) {
  await (tx ?? prisma).invitation.updateMany({
    where: { id: requireId(invitationId, "invitationId"), status: "OPEN" },
    data: { status: "USED" },
  });
}

/**
 * A seller's earlier listings, newest first, for the Create invitation screen.
 * @param {string} email
 * @returns {Promise<Array<{ listingId: string, title: string | null, itemSummary: string, status: string, createdAt: Date }>>}
 */
export async function findSellerHistory(email) {
  const sellerEmail = requireEmail(email, "email");
  const invitations = await prisma.invitation.findMany({
    where: { sellerEmail },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { listing: { select: { id: true, title: true, status: true } } },
  });
  return invitations
    .filter((invitation) => invitation.listing)
    .map((invitation) => ({
      listingId: invitation.listing.id,
      title: invitation.listing.title,
      itemSummary: invitation.itemSummary,
      status: invitation.listing.status,
      createdAt: invitation.createdAt,
    }));
}

/**
 * Seller contact details for a batch of listings: the only way other modules read them.
 * PRIVATE: never put them in public output (storefront, metaobjects, buyer emails) or logs.
 * @param {string[]} listingIds up to 500; duplicates are dropped
 * @returns {Promise<Map<string, { sellerEmail: string, sellerName: string }>>} unknown ids are left out
 */
export async function getSellerContacts(listingIds) {
  // DECISION: at most 500 ids, so a job batch of 200 listings is one call (F04-FIX-4).
  const ids = requireIdList(listingIds, "listingIds", { max: 500 });
  if (ids.length === 0) return new Map();
  const listings = await prisma.listing.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      invitation: { select: { sellerEmail: true, sellerName: true } },
    },
  });
  return new Map(
    listings.map(({ id, invitation }) => [
      id,
      {
        sellerEmail: invitation.sellerEmail,
        sellerName: invitation.sellerName,
      },
    ]),
  );
}

/**
 * One invitation for the staff screen. Never includes the token hash.
 * @param {string} invitationId
 */
export async function getInvitationForStaff(invitationId) {
  const invitation = await prisma.invitation.findUnique({
    where: { id: requireId(invitationId, "invitationId") },
    omit: { tokenHash: true },
    include: {
      listing: {
        select: { id: true, status: true, title: true, closedAt: true },
      },
    },
  });
  return invitation;
}
