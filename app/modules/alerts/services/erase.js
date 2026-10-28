// Privacy redact (F08-T5): remove alert subscribers.
import prisma from "@/db.server";
import { requireEmail } from "@/modules/core/index.js";

/**
 * Deletes this subscriber (confirmed or not). Repeats change nothing.
 * @param {string} email
 * @returns {Promise<{ subscribers: number }>}
 */
export async function eraseSubscriber(email) {
  const { count } = await prisma.alertSubscriber.deleteMany({
    where: { email: requireEmail(email, "email") },
  });
  return { subscribers: count };
}

/**
 * Deletes every subscriber (shop/redact).
 * @returns {Promise<{ subscribers: number }>}
 */
export async function eraseAllSubscribers() {
  const { count } = await prisma.alertSubscriber.deleteMany({});
  return { subscribers: count };
}
