// Every seller request starts here: is this link valid, and may it still be used?
import prisma from "@/db.server";
import { TERMINAL_STATUSES } from "@/modules/core/index.js";
import { hashSecret, isWellFormedToken, safeEqualHex } from "./tokens.js";

// Compared against when no row matches, so a miss costs about the same as a hit.
const DUMMY_HASH = "0".repeat(64);

/**
 * @typedef {{ state: "OK", invitation: object, listing: object }
 *   | { state: "INVALID" | "EXPIRED" | "REVOKED" | "CLOSED", reason?: "DEADLINE" }} Resolved
 */

/**
 * Check a seller link: the invitation status, its expiry and the listing state, every time.
 * @param {unknown} token from the URL; never logged
 * @param {{ now?: Date }} [options]
 * @returns {Promise<Resolved>}
 */
export async function resolveToken(token, { now = new Date() } = {}) {
  if (!isWellFormedToken(token)) return { state: "INVALID" };
  const hash = hashSecret(/** @type {string} */ (token));
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hash },
    include: { listing: true },
  });
  if (!safeEqualHex(invitation?.tokenHash ?? DUMMY_HASH, hash) || !invitation)
    return { state: "INVALID" };

  const { listing } = invitation;
  if (invitation.status === "REVOKED") return { state: "REVOKED" };
  // An unused link expires; once the seller has started, the listing's own deadlines apply.
  if (
    invitation.status === "EXPIRED" ||
    (invitation.status === "OPEN" &&
      listing?.status === "INVITED" &&
      invitation.expiresAt <= now)
  )
    return { state: "EXPIRED" };
  // DECISION: a LAPSED listing keeps its link, so a staff re-issue works without a new one.
  if (
    !listing ||
    invitation.status === "CLOSED" ||
    (TERMINAL_STATUSES.includes(listing.status) && listing.status !== "LAPSED")
  )
    return { state: "CLOSED" };
  // DECISION (F04-T2): a passed draft or correction deadline closes the page at once, on every
  // request. The EXPIRE transition and the seller's email are the scheduled job's (F08-T1).
  if (
    (listing.status === "DRAFT" && pastDue(listing.draftDueBy, now)) ||
    (listing.status === "CHANGES_REQUESTED" &&
      pastDue(listing.correctionDueBy, now))
  )
    return { state: "CLOSED", reason: "DEADLINE" };
  return { state: "OK", invitation, listing };
}

const pastDue = (deadline, now) => deadline !== null && deadline <= now;
