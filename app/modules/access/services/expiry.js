// The hourly invitation task: expire unused links and clear old sign-in codes.
import prisma from "@/db.server";
import { writeAudit } from "@/modules/core/index.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Safe to repeat: an expired invitation isn't OPEN any more and isn't picked up again.
 * @param {{ now?: Date }} [context]
 * @returns {Promise<{ expired: number, codesDeleted: number }>} counts only
 */
export async function runExpiry({ now = new Date() } = {}) {
  const due = await prisma.invitation.findMany({
    where: {
      status: "OPEN",
      expiresAt: { lte: now },
      listing: { status: "INVITED" },
    },
    select: { id: true, listing: { select: { id: true } } },
  });
  let expired = 0;
  for (const invitation of due) {
    const { count } = await prisma.invitation.updateMany({
      where: { id: invitation.id, status: "OPEN" },
      data: { status: "EXPIRED" },
    });
    if (count === 0) continue;
    await writeAudit({
      action: "InvitationExpired",
      listingId: invitation.listing?.id ?? null,
      details: { invitationId: invitation.id },
    });
    expired += 1;
  }
  const { count: codesDeleted } = await prisma.emailCode.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - DAY_MS) } },
  });
  return { expired, codesDeleted };
}
