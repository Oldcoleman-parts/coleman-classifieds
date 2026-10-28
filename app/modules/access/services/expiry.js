// The hourly invitation task: expire unused links and clear old sign-in codes.
import prisma from "@/db.server";
import { closeUnusedListing, SYSTEM_ACTOR } from "@/modules/core/index.js";

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
    // The link and the listing record close together; core writes the one audit entry (F01-FIX-3).
    // DECISION (F01-FIX-3): each invitation has its own transaction. If one fails (e.g. the
    // seller opened the link just now, so the listing left INVITED), only that one rolls
    // back and the rest still expire; the next run retries it if it is still due.
    try {
      const done = await prisma.$transaction(async (tx) => {
        const { count } = await tx.invitation.updateMany({
          where: { id: invitation.id, status: "OPEN" },
          data: { status: "EXPIRED" },
        });
        if (count === 0) return false;
        await closeUnusedListing(
          invitation.listing.id,
          "INVITATION_EXPIRED",
          SYSTEM_ACTOR,
          { tx, now },
        );
        return true;
      });
      if (done) expired += 1;
    } catch (error) {
      // IDs and the error name only: never a token, an email or a message with data in it.
      console.error("access.expire-invitations: could not expire", {
        invitationId: invitation.id,
        error: error?.name ?? "Error",
      });
    }
  }
  const { count: codesDeleted } = await prisma.emailCode.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - DAY_MS) } },
  });
  return { expired, codesDeleted };
}
