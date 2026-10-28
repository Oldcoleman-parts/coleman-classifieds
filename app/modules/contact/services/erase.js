// Privacy redact (F08-T5): blank a buyer's messages. The rows stay (listing, status, times)
// so the message counts still add up.
// DECISION (F08-FIX-8, user-approved, replaces F08-T5's "a HELD message stays HELD"): an
// erased HELD message is DISCARDED, so it leaves the held list and can't be released with
// no buyer to reply to. `relay()` also refuses a message without a buyer email.
import prisma from "@/db.server";
import { requireEmail } from "@/modules/core/index.js";

const BLANK = { buyerName: "", buyerEmail: "", body: "", ip: "" };

/**
 * @param {import("@prisma/client").Prisma.BuyerMessageWhereInput} where
 * @param {Date} now
 */
function eraseWhere(where, now) {
  return prisma.$transaction(async (tx) => {
    await tx.buyerMessage.updateMany({
      where: { ...where, status: "HELD" },
      data: { status: "DISCARDED", reviewedBy: null, reviewedAt: now },
    });
    const { count } = await tx.buyerMessage.updateMany({ where, data: BLANK });
    return { messages: count };
  });
}

/**
 * Blanks name, email, body and ip (all NOT NULL) of this buyer's messages; a HELD one is
 * discarded.
 * @param {string} email
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{ messages: number }>}
 */
export function eraseBuyer(email, { now = new Date() } = {}) {
  return eraseWhere({ buyerEmail: requireEmail(email, "email") }, now);
}

/**
 * The same for every message not yet blanked (shop/redact).
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{ messages: number }>}
 */
export function eraseAllBuyers({ now = new Date() } = {}) {
  return eraseWhere(
    {
      OR: [
        { buyerName: { not: "" } },
        { buyerEmail: { not: "" } },
        { body: { not: "" } },
        { ip: { not: "" } },
      ],
    },
    now,
  );
}
