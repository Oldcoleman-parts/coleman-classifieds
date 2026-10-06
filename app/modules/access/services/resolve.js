// Every seller request starts here: is this link valid, and may it still be used?
import prisma from "@/db.server";
import { TERMINAL_STATUSES } from "@/modules/core/index.js";
import { hashSecret, isWellFormedToken, safeEqualHex } from "./tokens.js";

// Compared against when no row matches, so a miss costs about the same as a hit.
const DUMMY_HASH = "0".repeat(64);

/**
 * @typedef {{ state: "OK", invitation: object, listing: object }
 *   | { state: "INVALID" | "EXPIRED" | "REVOKED" | "CLOSED" }} Resolved
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
  return { state: "OK", invitation, listing };
}
