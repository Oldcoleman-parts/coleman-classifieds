// The hourly payment tasks. Each is safe to run twice: two runs have the effect of one.
import prisma from "@/db.server";
import {
  getSettings,
  InvalidTransitionError,
  LISTING_EVENTS,
  SYSTEM_ACTOR,
  transition,
} from "@/modules/core/index.js";
import { prepareForPayment, sendPayEmail } from "./approval.js";
import { DAY_MS } from "./constants.js";
import { deleteDiscount } from "./discount.js";
import { AWAITING, findPayables } from "./facts.js";
import { offlineAdmin, shopDomain } from "./shop.js";

/** Log a per-listing failure by id and error type only, and carry on with the rest. */
const failed = (task, listingId, error) =>
  console.error(
    `[payments] ${task} failed for ${listingId}: ${error?.code ?? error?.name ?? "Error"}`,
  );

/**
 * Finish what the approval could not: a discount code Shopify refused at the time, or an
 * `approved_pay` email that failed (retried up to three times, an hour apart).
 * @param {{ now?: Date }} [context]
 * @returns {Promise<{ checked: number, emailFailed: number, errors: number }>}
 */
export async function runFollowUps({ now = new Date() } = {}) {
  const listings = await findPayables({
    status: AWAITING,
    paymentDueBy: { gt: now },
  });
  const summary = { checked: listings.length, emailFailed: 0, errors: 0 };
  if (listings.length === 0) return summary;
  const admin = await offlineAdmin();
  const shop = shopDomain();
  for (const { id } of listings) {
    try {
      const result = await prepareForPayment(id, { admin, shop, now });
      if (result === "EMAIL_FAILED") summary.emailFailed += 1;
    } catch (error) {
      summary.errors += 1;
      failed("follow-up", id, error);
    }
  }
  return summary;
}

/**
 * Remind sellers who have not paid, `paymentReminderDaysBefore` days before the deadline.
 * @param {{ now?: Date }} [context]
 * @returns {Promise<{ due: number, failed: number }>}
 */
export async function runReminders({ now = new Date() } = {}) {
  const { paymentReminderDaysBefore } = await getSettings();
  const ahead = paymentReminderDaysBefore * DAY_MS;
  const listings = await findPayables({
    status: AWAITING,
    paymentDueBy: { gt: now, lte: new Date(now.getTime() + ahead) },
  });
  const summary = { due: listings.length, failed: 0 };
  if (listings.length === 0) return summary;
  const admin = await offlineAdmin();
  const shop = shopDomain();
  for (const payable of listings) {
    try {
      const since = new Date(
        /** @type {Date} */ (payable.paymentDueBy).getTime() - ahead,
      );
      const status = await sendPayEmail("payment_reminder", payable, {
        admin,
        shop,
        since,
        now,
      });
      if (status === "FAILED") summary.failed += 1;
    } catch (error) {
      summary.failed += 1;
      failed("reminder", payable.id, error);
    }
  }
  return summary;
}

/**
 * Lapse approved listings that were not paid in time, and delete discount codes that are no
 * longer needed (the backstop for a `ListingClosed` clean-up that failed, and for used codes).
 * @param {{ now?: Date }} [context]
 * @returns {Promise<{ lapsed: number, codesDeleted: number, errors: number }>}
 */
export async function runLapse({ now = new Date() } = {}) {
  const summary = { lapsed: 0, codesDeleted: 0, errors: 0 };
  const overdue = await findPayables({
    status: AWAITING,
    paymentDueBy: { lte: now },
  });
  for (const { id } of overdue) {
    try {
      await transition(id, LISTING_EVENTS.LAPSE, SYSTEM_ACTOR, {}, { now });
      summary.lapsed += 1;
    } catch (error) {
      // Paid a moment ago: nothing to lapse.
      if (error instanceof InvalidTransitionError) continue;
      summary.errors += 1;
      failed("lapse", id, error);
    }
  }

  const leftovers = await prisma.listing.findMany({
    where: { discountCodeId: { not: null }, status: { not: AWAITING } },
    select: { id: true, discountCodeId: true },
    take: 200,
  });
  if (leftovers.length === 0) return summary;
  const admin = await offlineAdmin();
  for (const listing of leftovers) {
    try {
      if (await deleteDiscount(listing, { admin })) summary.codesDeleted += 1;
    } catch (error) {
      summary.errors += 1;
      failed("discount clean-up", listing.id, error);
    }
  }
  return summary;
}
