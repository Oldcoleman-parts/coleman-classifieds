// Privacy redact (F08-T5): anonymise sellers' invitations. Ops calls these through index.js.
// The invitation row stays (its listing points at it); only the personal fields change.
import prisma from "@/db.server";
import { requireEmail } from "@/modules/core/index.js";

/**
 * The listings of every invitation sent to this email: ops reads them before the invitation
 * is redacted, to find the seller's terms acceptances.
 * @param {string} email
 * @returns {Promise<string[]>}
 */
export async function listingIdsForSellerEmail(email) {
  const sellerEmail = requireEmail(email, "email");
  const invitations = await prisma.invitation.findMany({
    where: { sellerEmail },
    select: { listing: { select: { id: true } } },
  });
  return invitations.flatMap(({ listing }) => (listing ? [listing.id] : []));
}

/**
 * Name and item summary `Redacted`, email `redacted+<id>@invalid`, no phone; an unused
 * (OPEN) link is closed so it can't be started (F08-FIX-8). Repeats change nothing.
 * @param {string} email
 * @returns {Promise<{ invitations: number }>}
 */
export async function eraseSeller(email) {
  const sellerEmail = requireEmail(email, "email");
  const invitations = await prisma.$executeRaw`
    UPDATE "Invitation"
    SET "sellerName" = 'Redacted', "sellerEmail" = 'redacted+' || "id" || '@invalid', "sellerPhone" = NULL,
      "itemSummary" = 'Redacted',
      "status" = CASE WHEN "status" = 'OPEN' THEN 'CLOSED'::"InvitationStatus" ELSE "status" END
    WHERE "sellerEmail" = ${sellerEmail}`;
  return { invitations };
}

/**
 * The same for every invitation not yet redacted (shop/redact).
 * @returns {Promise<{ invitations: number }>}
 */
export async function eraseAllSellers() {
  const invitations = await prisma.$executeRaw`
    UPDATE "Invitation"
    SET "sellerName" = 'Redacted', "sellerEmail" = 'redacted+' || "id" || '@invalid', "sellerPhone" = NULL,
      "itemSummary" = 'Redacted',
      "status" = CASE WHEN "status" = 'OPEN' THEN 'CLOSED'::"InvitationStatus" ELSE "status" END
    WHERE "sellerEmail" <> 'redacted+' || "id" || '@invalid'`;
  return { invitations };
}

/**
 * Whether an invitation's seller was erased: their address is `redacted+<id>@invalid`
 * (`.invalid` never delivers), so nobody is emailed there.
 * @param {string} sellerEmail
 */
export function isRedactedSeller(sellerEmail) {
  return /^redacted\+[^@]+@invalid$/.test(sellerEmail);
}
