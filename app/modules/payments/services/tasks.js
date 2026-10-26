// The hourly payment tasks. Each is safe to run twice: two runs have the effect of one.
import prisma from "@/db.server";
import {
  getSettings,
  InvalidTransitionError,
  LISTING_EVENTS,
  SYSTEM_ACTOR,
  transition,
} from "@/modules/core/index.js";
import { startApply } from "./apply.js";
import { prepareForPayment, sendPayEmail } from "./approval.js";
import { DAY_MS, MINUTE_MS } from "./constants.js";
import { deleteDiscount } from "./discount.js";
import { AWAITING, findPayables } from "./facts.js";
import { reportPaymentProblem } from "./incidents.js";
import { findPaidCharge, reconcilePaidOrders } from "./reconcile.js";
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
 * Record paid fee orders whose `orders/paid` was lost (F06-FIX-3). Errors go to the scheduler.
 * @param {{ now?: Date }} [context]
 */
export async function runReconcile({ now = new Date() } = {}) {
  return reconcilePaidOrders({ admin: await offlineAdmin(), now });
}

/**
 * Lapse approved listings that were not paid in time, and delete discount codes that are no
 * longer needed (the backstop for a `ListingClosed` clean-up that failed, and for used codes).
 * F06-FIX-3: Shopify is asked first. A listing whose fee was paid goes live instead, and when
 * Shopify can't be reached nothing is lapsed this run.
 * @param {{ now?: Date }} [context]
 * @returns {Promise<{ lapsed: number, applied: number, codesDeleted: number, errors: number, skipped?: true }>}
 */
export async function runLapse({ now = new Date() } = {}) {
  const summary = { lapsed: 0, applied: 0, codesDeleted: 0, errors: 0 };
  const due = { status: AWAITING, paymentDueBy: { lte: now } };
  let overdue = await findPayables(due);
  /** @type {import("@/modules/platform/services/graphql.js").GraphqlClient | undefined} */
  let admin;
  if (overdue.length > 0) {
    try {
      admin = await offlineAdmin();
      await reconcilePaidOrders({
        admin,
        now,
        listingIds: overdue.map(({ id }) => id),
      });
    } catch (error) {
      await reportPaymentProblem(
        "lapse-skipped",
        "Shopify could not be reached, so no unpaid listing was lapsed this run.",
        { code: error?.code ?? error?.name ?? "Error" },
        { now },
      );
      return { ...summary, skipped: true };
    }
    overdue = await findPayables(due);
  }
  for (const { id } of overdue) {
    try {
      // Paid, but not applied yet: finish it rather than lapse a listing the seller paid for.
      const charge = await findPaidCharge(id);
      if (charge) {
        if (!charge.appliedAt) await startApply(charge.id, { now });
        summary.applied += 1;
        continue;
      }
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
  admin ??= await offlineAdmin();
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

/**
 * Finish charges whose apply step didn't complete after the webhook answered (a failed
 * `PaymentReceived` handler, a fulfilment Shopify refused, a restart). Charges younger than
 * two minutes are left to the run the webhook started.
 * DECISION (F06-FIX-2): a charge is retried for 7 days, then left to staff (its problem is
 * on record); 10 a run, since one go-live takes about 10 seconds.
 * @param {{ now?: Date }} [context]
 * @returns {Promise<{ pending: number, applied: number, retry: number }>}
 */
export async function runApplyPaidCharges({ now = new Date() } = {}) {
  const charges = await prisma.feeCharge.findMany({
    where: {
      kind: "INITIAL",
      status: "PAID",
      appliedAt: null,
      orderGid: { not: null },
      createdAt: {
        gte: new Date(now.getTime() - 7 * DAY_MS),
        lte: new Date(now.getTime() - 2 * MINUTE_MS),
      },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 10,
  });
  const summary = { pending: charges.length, applied: 0, retry: 0 };
  for (const { id } of charges) {
    const result = await startApply(id, { now });
    if (result === "APPLIED") summary.applied += 1;
    else if (result === "RETRY") summary.retry += 1;
  }
  return summary;
}
