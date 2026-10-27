// What core does with a `PaymentReceived` event (F01-FIX-1). The seller has already paid, so
// a failure here must never be lost: a temporary one is thrown, so the payments apply step
// leaves appliedAt empty and its task retries; a payment that can never be applied is recorded
// for staff.
import prisma from "@/db.server";
import { SYSTEM_ACTOR } from "./actors.js";
import {
  ConflictError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
} from "./errors.js";
import { writeAudit } from "./events.js";
import { LISTING_EVENTS, transition } from "./lifecycle.js";

/** Audit action of a payment that could not make its listing live. */
export const PAYMENT_NOT_APPLIED = "PaymentNotApplied";

const AWAITING = "APPROVED_AWAITING_PAYMENT";
const LIVE_STATUSES = ["LIVE", "PAUSED"];
// DECISION (F01-FIX-1): a listing that closed after it was live has used its payment, so a
// repeated event is not a refund case. LAPSED and REJECTED never are: the fee was not used.
const CLOSED_AFTER_LIVE = ["SOLD", "REMOVED", "EXPIRED"];

function alreadyApplied({ status, liveAt }) {
  if (LIVE_STATUSES.includes(status)) return true;
  return CLOSED_AFTER_LIVE.includes(status) && liveAt !== null;
}

/**
 * Apply a received payment to its listing.
 * @param {import("./events.js").PaymentReceived} payment
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{ outcome: "APPLIED" | "ALREADY_APPLIED" | "NOT_APPLICABLE", status: string | null }>}
 *   `NOT_APPLICABLE`: the listing got `refundFlag` and a `PaymentNotApplied` audit entry
 * @throws on a temporary failure (database, lock); nothing is written and a retry is safe
 */
export async function applyPayment(
  { listingId, orderGid, billingMode },
  options = {},
) {
  let cause;
  try {
    const listing = await transition(
      listingId,
      LISTING_EVENTS.PAY,
      SYSTEM_ACTOR,
      { billingMode },
      options,
    );
    return { outcome: "APPLIED", status: listing.status };
  } catch (error) {
    // Only these mean "a retry cannot help". Everything else goes back to the publisher.
    const final =
      error instanceof InvalidTransitionError ||
      error instanceof NotFoundError ||
      error instanceof ValidationError;
    if (!final) throw error;
    cause = error;
  }

  const details = { orderGid: typeof orderGid === "string" ? orderGid : null };
  // A second transaction, after the first one rolled back: the flag and its audit entry
  // are written together or not at all.
  return prisma.$transaction(async (tx) => {
    let current = null;
    if (typeof listingId === "string" && listingId !== "") {
      await tx.$queryRaw`SELECT id FROM "Listing" WHERE id = ${listingId} FOR UPDATE`;
      current = await tx.listing.findUnique({
        where: { id: listingId },
        select: { status: true, liveAt: true, refundFlag: true },
      });
    }
    if (!current) {
      await writeAudit(
        {
          action: PAYMENT_NOT_APPLIED,
          details: { ...details, reason: "LISTING_NOT_FOUND" },
        },
        { tx },
      );
      return { outcome: "NOT_APPLICABLE", status: null };
    }

    const { status } = current;
    if (cause instanceof InvalidTransitionError) {
      // Staff re-issued the listing between the two transactions: the retry applies PAY.
      if (status === AWAITING)
        throw new ConflictError("The listing changed while paying; retry");
      if (alreadyApplied(current))
        return { outcome: "ALREADY_APPLIED", status };
    }
    // A repeated event adds nothing: the audit log is append-only.
    if (current.refundFlag) return { outcome: "NOT_APPLICABLE", status };

    await tx.listing.update({
      where: { id: listingId },
      data: { refundFlag: true },
    });
    await writeAudit(
      {
        action: PAYMENT_NOT_APPLIED,
        listingId,
        details: {
          ...details,
          status,
          reason:
            cause instanceof ValidationError ? "INVALID_EVENT" : "NOT_PAYABLE",
        },
      },
      { tx },
    );
    return { outcome: "NOT_APPLICABLE", status };
  });
}
