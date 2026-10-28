// The invitation email (F04-FIX-3): sent to the seller as soon as staff create the invitation,
// and again on a staff resend. Only the link's hash is stored, so a resend issues a new link and
// the earlier one stops working. The link and token are never logged or written to the audit log;
// the `invitation` template is sensitive, so its data is never stored in the outbox either.
import { randomUUID } from "node:crypto";
import prisma from "@/db.server";
import {
  ConflictError,
  NotFoundError,
  requireId,
  requireStaff,
  writeAudit,
} from "@/modules/core/index.js";
import {
  getEmailStatus,
  isSuppressed,
  send,
} from "@/modules/notifications/index.js";
import { sellerLink, storefrontBase } from "./links.js";
import { formatDay } from "./my-link.js";
import { hashSecret, newToken } from "./tokens.js";

export const MAX_RESENDS_PER_DAY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/** @param {string} invitationId */
export const initialEmailKey = (invitationId) => `invitation:${invitationId}`;

/**
 * @typedef {"SENT" | "FAILED" | "SUPPRESSED" | "PENDING"} SendOutcome
 * @typedef {"SENT" | "NOT_SENT" | "NOT_DELIVERED" | "SENDING" | "UNKNOWN"} EmailState
 */

/** @param {string} status an outbox status */
function outcomeOf(status) {
  if (status === "SENT" || status === "SUPPRESSED") return status;
  if (status === "PENDING" || status === "SENDING") return "PENDING";
  return "FAILED";
}

/**
 * Is the invitation still unused and open, so its email may be resent?
 * @param {{ status: string, expiresAt: Date, listing?: { status: string, closedAt?: Date | null } | null }} invitation
 * @param {Date} now
 */
export const isResendable = (invitation, now) =>
  invitation.status === "OPEN" &&
  invitation.listing?.status === "INVITED" &&
  !invitation.listing.closedAt &&
  invitation.expiresAt > now;

/**
 * Send the invitation email. Never throws for a send failure: the invitation stays, and the
 * outcome is recorded in an `InvitationEmailed` audit entry (no link).
 * @param {{ id: string, sellerName: string, sellerEmail: string, itemSummary: string, expiresAt: Date }} invitation
 * @param {string} token never logged
 * @param {{ admin: object, shop: string, staff: import("@/modules/core/types.js").ActorRef,
 *   staffFirstName?: string, listingId: string, idempotencyKey: string,
 *   kind: "CREATE" | "RESEND", now?: Date }} options
 * @returns {Promise<{ outcome: SendOutcome, at: Date, link: string }>}
 */
export async function sendInvitationEmail(
  invitation,
  token,
  {
    admin,
    shop,
    staff,
    staffFirstName = "",
    listingId,
    idempotencyKey,
    kind,
    now = new Date(),
  },
) {
  const link = sellerLink(await storefrontBase(admin, shop), token);
  /** @type {SendOutcome} */
  let outcome;
  let outboxId = null;
  try {
    const result = await send(
      "invitation",
      invitation.sellerEmail,
      {
        seller_first_name: invitation.sellerName.split(/\s+/)[0],
        item_summary: invitation.itemSummary,
        invitation_link: link,
        invitation_expiry_date: formatDay(invitation.expiresAt),
        staff_first_name: staffFirstName,
      },
      { idempotencyKey, now },
    );
    outcome = outcomeOf(result.status);
    outboxId = result.outboxId;
  } catch (error) {
    console.error(
      `[access] invitation email failed: ${error?.name ?? "Error"}`,
    );
    outcome = "FAILED";
  }
  await writeAudit({
    action: "InvitationEmailed",
    actor: staff,
    listingId,
    details: { invitationId: invitation.id, kind, outcome, outboxId },
  });
  return { outcome, at: now, link };
}

/**
 * Resend the invitation email with a new link. The earlier link stops working at once; the
 * fee, the listing and the expiry date don't change.
 * DECISION (F04-FIX-3): the limit is 5 resends per invitation in a rolling 24 hours. Every
 * resend that issued a new link counts, failed sends included (client, 2026-10-19). A refused
 * resend changes nothing and writes no audit entry.
 * @param {string} invitationId
 * @param {import("@/modules/core/types.js").ActorRef} actor staff only
 * @param {{ admin: object, shop: string, staffFirstName?: string, now?: Date }} options
 * @returns {Promise<{ outcome: SendOutcome, at: Date, link?: string }>} `link` only when the
 *   email wasn't sent, so staff can copy it (shown once, never stored)
 * @throws {ConflictError} when the invitation isn't open, the address is suppressed or the
 *   daily limit is reached
 */
export async function resendInvitation(
  invitationId,
  actor,
  { admin, shop, staffFirstName = "", now = new Date() },
) {
  const staff = requireStaff(actor);
  const id = requireId(invitationId, "invitationId");
  const invitation = await prisma.invitation.findUnique({
    where: { id },
    include: {
      listing: { select: { id: true, status: true, closedAt: true } },
    },
  });
  if (!invitation) throw new NotFoundError("Invitation not found");
  if (!isResendable(invitation, now))
    throw new ConflictError("Only an open, unused invitation can be resent.");
  if (await isSuppressed(invitation.sellerEmail))
    throw new ConflictError(
      "This address is on the do-not-email list (an earlier email bounced or was marked as spam), so the email can’t be delivered. Revoke this invitation and create one with the right address.",
    );

  const listingId = invitation.listing.id;
  const token = newToken();
  const sendKey = `invitation:${id}:resend:${randomUUID()}`;
  await prisma.$transaction(async (tx) => {
    // Two clicks at once must not both pass the limit.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invite-resend:${id}`}))`;
    const fresh = await tx.invitation.findUnique({
      where: { id },
      include: {
        listing: { select: { id: true, status: true, closedAt: true } },
      },
    });
    if (!fresh || !isResendable(fresh, now))
      throw new ConflictError("Only an open, unused invitation can be resent.");
    if ((await countResends(listingId, now, { tx })) >= MAX_RESENDS_PER_DAY)
      throw new ConflictError(
        `The invitation email can be resent ${MAX_RESENDS_PER_DAY} times a day. Try again tomorrow.`,
      );
    // Only the hash changes: never the fee, the listing or the expiry date.
    const { count } = await tx.invitation.updateMany({
      where: { id, status: "OPEN" },
      data: { tokenHash: hashSecret(token) },
    });
    if (count === 0)
      throw new ConflictError("Only an open, unused invitation can be resent.");
    await writeAudit(
      {
        action: "InvitationResent",
        actor: staff,
        listingId,
        details: { invitationId: id, sendKey },
      },
      { tx },
    );
  });

  const { outcome, at, link } = await sendInvitationEmail(invitation, token, {
    admin,
    shop,
    staff,
    staffFirstName,
    listingId,
    idempotencyKey: sendKey,
    kind: "RESEND",
    now,
  });
  return outcome === "SENT" ? { outcome, at } : { outcome, at, link };
}

/**
 * Resends in the 24 hours before `now`.
 * @param {string} listingId
 * @param {Date} now
 * @param {{ tx?: import("@prisma/client").Prisma.TransactionClient }} [options]
 */
function countResends(listingId, now, { tx } = {}) {
  return (tx ?? prisma).auditEvent.count({
    where: {
      action: "InvitationResent",
      listingId,
      at: { gte: new Date(now.getTime() - DAY_MS) },
    },
  });
}

/**
 * The invitation email's state for the staff screen: the latest send only, status and time.
 * DECISION (F04-FIX-3): "SENT" means SES accepted it; a bounce shows as NOT_DELIVERED through
 * the suppression list. Outbox rows go after 30 days, so an old invitation shows UNKNOWN.
 * @param {{ id: string, sellerEmail: string, status: string, expiresAt: Date,
 *   listing?: { id: string, status: string, closedAt?: Date | null } | null }} invitation
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{ state: EmailState, at: Date | null, resendsLeft: number, canResend: boolean }>}
 */
export async function getInvitationEmailStatus(
  invitation,
  { now = new Date() } = {},
) {
  const listingId = invitation.listing?.id ?? null;
  const [suppressed, latest, used] = await Promise.all([
    isSuppressed(invitation.sellerEmail),
    listingId
      ? prisma.auditEvent.findFirst({
          where: { listingId, action: "InvitationResent" },
          orderBy: [{ at: "desc" }, { id: "desc" }],
          select: { details: true },
        })
      : null,
    listingId ? countResends(listingId, now) : 0,
  ]);
  const resendKey = latest?.details?.sendKey;
  const key =
    typeof resendKey === "string" ? resendKey : initialEmailKey(invitation.id);
  const sent = await getEmailStatus(key);

  /** @type {EmailState} */
  let state = "UNKNOWN";
  if (suppressed || sent?.status === "SUPPRESSED") state = "NOT_DELIVERED";
  else if (sent?.status === "SENT") state = "SENT";
  else if (sent?.status === "FAILED" || sent?.status === "DEAD")
    state = "NOT_SENT";
  else if (sent) state = "SENDING";

  const resendsLeft = Math.max(0, MAX_RESENDS_PER_DAY - used);
  return {
    state,
    at: sent?.at ?? null,
    resendsLeft,
    canResend: isResendable(invitation, now) && !suppressed && resendsLeft > 0,
  };
}
