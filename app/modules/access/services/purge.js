// The records purge (F08-T4): an invitation and its sign-in codes, after its listing was
// deleted in the same purge transaction (the listing points at the invitation).
import { requireId } from "@/modules/core/index.js";

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {string} invitationId
 * @returns {Promise<{ codes: number, invitations: number }>}
 */
export async function purgeInvitation(tx, invitationId) {
  const id = requireId(invitationId, "invitationId");
  const codes = await tx.emailCode.deleteMany({ where: { invitationId: id } });
  const invitations = await tx.invitation.deleteMany({ where: { id } });
  return { codes: codes.count, invitations: invitations.count };
}
