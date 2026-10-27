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
 * Name `Redacted`, email `redacted+<id>@invalid`, no phone. Repeats change nothing.
 * @param {string} email
 * @returns {Promise<{ invitations: number }>}
 */
export async function eraseSeller(email) {
  const sellerEmail = requireEmail(email, "email");
  const invitations = await prisma.$executeRaw`
    UPDATE "Invitation"
    SET "sellerName" = 'Redacted', "sellerEmail" = 'redacted+' || "id" || '@invalid', "sellerPhone" = NULL
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
    SET "sellerName" = 'Redacted', "sellerEmail" = 'redacted+' || "id" || '@invalid', "sellerPhone" = NULL
    WHERE "sellerEmail" <> 'redacted+' || "id" || '@invalid'`;
  return { invitations };
}
