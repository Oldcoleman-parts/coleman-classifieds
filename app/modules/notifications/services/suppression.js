// Addresses the app must never email again (hard bounces and complaints).
import prisma from "@/db.server";
import { emailHash } from "./hash.js";

/**
 * @param {string} email
 * @returns {Promise<boolean>}
 */
export async function isSuppressed(email) {
  const row = await prisma.emailSuppression.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { email: true },
  });
  if (row) return true;
  // F08-FIX-8: an erased address is kept only as a hash.
  const marker = await prisma.emailSuppressionMarker.findUnique({
    where: { emailHash: emailHash(email) },
    select: { emailHash: true },
  });
  return marker !== null;
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
