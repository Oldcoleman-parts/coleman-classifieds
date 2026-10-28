// Hourly tidy-up: unconfirmed signups and old queue rows go, and the storefront switch is
// put right if a toggle's update was missed.
import prisma from "@/db.server";
import { syncSignupVisibility } from "./storefront.js";

const DAY_MS = 24 * 60 * 60 * 1000;
// DECISION (F07-T2): an unconfirmed signup is deleted after 30 days. Unsubscribed rows are
// kept, as the record of the opt-out.
const PENDING_DAYS = 30;
const SENT_QUEUE_DAYS = 90;

/**
 * @param {{ now?: Date }} [context]
 * @returns {Promise<{ purged: number, queuePurged: number, signupShown: boolean | null }>}
 */
export async function runHousekeeping({ now = new Date() } = {}) {
  const { count: purged } = await prisma.alertSubscriber.deleteMany({
    where: {
      confirmedAt: null,
      createdAt: { lt: new Date(now.getTime() - PENDING_DAYS * DAY_MS) },
    },
  });
  const { count: queuePurged } = await prisma.alertQueue.deleteMany({
    where: {
      sentAt: { lt: new Date(now.getTime() - SENT_QUEUE_DAYS * DAY_MS) },
    },
  });
  let signupShown = null;
  try {
    signupShown = await syncSignupVisibility();
  } catch (error) {
    console.error(
      `[alerts] signup switch sync failed: ${error?.code ?? error?.name ?? "Error"}`,
    );
  }
  return { purged, queuePurged, signupShown };
}
