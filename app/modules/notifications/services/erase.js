// Privacy redact (F08-T5): remove queued and sent emails to an address, and its suppression.
import prisma from "@/db.server";
import { requireEmail } from "@/modules/core/index.js";

/**
 * Deletes outbox rows sent to this address or with it as reply-to (a relayed buyer
 * message), and its suppression entry. Repeats change nothing.
 * @param {string} email
 * @returns {Promise<{ outbox: number, suppressions: number }>}
 */
export async function eraseAddress(email) {
  const address = requireEmail(email, "email");
  const [outbox, suppressions] = await prisma.$transaction([
    prisma.emailOutbox.deleteMany({
      where: { OR: [{ toAddress: address }, { replyTo: address }] },
    }),
    prisma.emailSuppression.deleteMany({ where: { email: address } }),
  ]);
  return { outbox: outbox.count, suppressions: suppressions.count };
}

/**
 * Deletes every outbox row and suppression entry (shop/redact).
 * @returns {Promise<{ outbox: number, suppressions: number }>}
 */
export async function eraseAllAddresses() {
  const [outbox, suppressions] = await prisma.$transaction([
    prisma.emailOutbox.deleteMany({}),
    prisma.emailSuppression.deleteMany({}),
  ]);
  return { outbox: outbox.count, suppressions: suppressions.count };
}
