// Privacy redact (F08-T5): remove queued and sent emails to an address, and its suppression.
// DECISION (F08-FIX-8): a suppressed address keeps a hashed marker (`EmailSuppressionMarker`,
// no plain email), so a bounced or complained address stays suppressed after the erase.
// A row being sent may be deleted too; the send then finishes without its row.
import prisma from "@/db.server";
import { requireEmail } from "@/modules/core/index.js";
import { emailHash } from "./hash.js";

/**
 * Deletes outbox rows sent to this address or with it as reply-to (a relayed buyer
 * message), and turns its suppression entry into a hashed marker. Repeats change nothing.
 * @param {string} email
 * @returns {Promise<{ outbox: number, suppressions: number }>}
 */
export async function eraseAddress(email) {
  const address = requireEmail(email, "email");
  return prisma.$transaction(async (tx) => {
    const suppression = await tx.emailSuppression.findUnique({
      where: { email: address },
    });
    if (suppression)
      await tx.emailSuppressionMarker.upsert({
        where: { emailHash: emailHash(address) },
        create: { emailHash: emailHash(address), reason: suppression.reason },
        update: {},
      });
    const outbox = await tx.emailOutbox.deleteMany({
      where: { OR: [{ toAddress: address }, { replyTo: address }] },
    });
    const suppressions = await tx.emailSuppression.deleteMany({
      where: { email: address },
    });
    return { outbox: outbox.count, suppressions: suppressions.count };
  });
}

/**
 * Deletes every outbox row, and turns every suppression entry into a hashed marker
 * (shop/redact).
 * @returns {Promise<{ outbox: number, suppressions: number }>}
 */
export async function eraseAllAddresses() {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.emailSuppression.findMany();
    if (rows.length > 0)
      await tx.emailSuppressionMarker.createMany({
        data: rows.map(({ email, reason }) => ({
          emailHash: emailHash(email),
          reason,
        })),
        skipDuplicates: true,
      });
    const outbox = await tx.emailOutbox.deleteMany({});
    const suppressions = await tx.emailSuppression.deleteMany({});
    return { outbox: outbox.count, suppressions: suppressions.count };
  });
}
