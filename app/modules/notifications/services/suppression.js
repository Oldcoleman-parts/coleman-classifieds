// Addresses the app must never email again (hard bounces and complaints).
import prisma from "@/db.server";

/**
 * @param {string} email
 * @returns {Promise<boolean>}
 */
export async function isSuppressed(email) {
  const row = await prisma.emailSuppression.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { email: true },
  });
  return row !== null;
}

/**
 * Stop sending to an address. The first reason is kept when it is reported again.
 * @param {string} email
 * @param {"BOUNCE" | "COMPLAINT"} reason
 * @returns {Promise<void>}
 */
export async function suppress(email, reason) {
  const address = email.trim().toLowerCase();
  await prisma.emailSuppression.upsert({
    where: { email: address },
    create: { email: address, reason },
    update: {},
  });
}
