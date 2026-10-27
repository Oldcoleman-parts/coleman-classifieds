// Privacy redact (F08-T5): blank a buyer's messages. The rows stay (listing, status, times)
// so the held-message counts still add up; a HELD message stays HELD.
import prisma from "@/db.server";
import { requireEmail } from "@/modules/core/index.js";

const BLANK = { buyerName: "", buyerEmail: "", body: "", ip: "" };

/**
 * Blanks name, email, body and ip (all NOT NULL) of this buyer's messages.
 * @param {string} email
 * @returns {Promise<{ messages: number }>}
 */
export async function eraseBuyer(email) {
  const buyerEmail = requireEmail(email, "email");
  const { count } = await prisma.buyerMessage.updateMany({
    where: { buyerEmail },
    data: BLANK,
  });
  return { messages: count };
}

/**
 * The same for every message not yet blanked (shop/redact).
 * @returns {Promise<{ messages: number }>}
 */
export async function eraseAllBuyers() {
  const { count } = await prisma.buyerMessage.updateMany({
    where: {
      OR: [
        { buyerName: { not: "" } },
        { buyerEmail: { not: "" } },
        { body: { not: "" } },
        { ip: { not: "" } },
      ],
    },
    data: BLANK,
  });
  return { messages: count };
}
