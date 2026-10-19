// Staff invitations: one private link, one listing. The fee and offer scope are locked here.
import prisma from "@/db.server";
import {
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
  requireStaff,
  requireString,
  ValidationError,
  writeAudit,
} from "@/modules/core/index.js";
import { hashSecret, newToken } from "./tokens.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const OFFER_SCOPES = ["FIRST_MONTH", "ALL_RENEWALS"];

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
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{ invitation: object, listing: object, token: string }>} the token is
 *   returned once and never stored: show it to staff, never log it
 */
export async function createInvitation(
  input,
  actor,
  { now = new Date() } = {},
) {
  const staff = requireStaff(actor);
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

  const { invitation, listing, event } = await prisma.$transaction(async (tx) => {
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
      { actor: staff, listingId: listing.id },
    );
    return { invitation, listing, event };
  });

  await dispatch(event);
  return { invitation, listing, token };
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
  // DECISION: the INVITED listing record is left as it is; closing it is a core follow-up.
  const { count } = await prisma.invitation.updateMany({
    where: { id, status: "OPEN" },
    data: { status: "REVOKED" },
  });
  if (count === 0) return false;
  await writeAudit({
    action: "InvitationRevoked",
    actor: staff,
    listingId: invitation.listing?.id ?? null,
    details: { invitationId: id },
  });
  return true;
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
 * One invitation for the staff screen. Never includes the token hash.
 * @param {string} invitationId
 */
export async function getInvitationForStaff(invitationId) {
  const invitation = await prisma.invitation.findUnique({
    where: { id: requireId(invitationId, "invitationId") },
    omit: { tokenHash: true },
    include: { listing: { select: { id: true, status: true, title: true } } },
  });
  return invitation;
}
