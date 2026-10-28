// New-listing alerts: one email to every confirmed subscriber when a listing first goes live.
// The go-live handler starts the send at once; the hourly task sends whatever is left unsent.
import prisma from "@/db.server";
import { isEnabled, writeAudit } from "@/modules/core/index.js";
import { getPublicUrls } from "@/modules/media/index.js";
import { isSuppressed, send } from "@/modules/notifications/index.js";
import { listingState } from "./facts.js";
import {
  browseUrl,
  listingUrl,
  storefrontBase,
  unsubscribeUrl,
} from "./links.js";
import { unsubscribeById } from "./subscribers.js";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
// DECISION (F07-T2): the sweep leaves rows younger than 15 minutes to the immediate send, so the
// two rarely overlap. When they do, the per-(listing, subscriber) idempotency key stops a
// second email, so no claim column is needed.
export const GRACE_MINUTES = 15;
// DECISION (F07-T2): a listing still unsent 3 days after its go-live (alerts were off, or its
// storefront page never appeared) is dropped rather than announced as new.
export const STALE_DAYS = 3;
// DECISION (F07-T2): at most 10 listings per hourly run (the task has 5 minutes); the rest wait
// for the next run.
export const SWEEP_LIMIT = 10;
const BATCH = 200;

/**
 * @typedef {{ listingId: string, sent: number, skipped: number, failed: number,
 *   paused?: boolean, dropped?: boolean, waiting?: boolean, done?: boolean }} AlertResult
 */

/** @param {number | null} cents @returns {string} e.g. "$120" or "$85.50" */
function price(cents) {
  if (cents === null || cents === undefined) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/**
 * @param {import("./facts.js").ListingFacts} listing
 * @param {string} base
 */
async function alertItem(listing, base) {
  const [photo] = await getPublicUrls(listing.id, "medium");
  return {
    title: listing.title,
    asking_price: price(listing.askingPriceCents),
    city: listing.city,
    state: listing.state,
    listing_url: listingUrl(base, listing.handle),
    photo_url: photo ?? "",
  };
}

/** @param {string} listingId @param {Date} now */
const markSent = (listingId, now) =>
  prisma.alertQueue.updateMany({
    where: { listingId, sentAt: null },
    data: { sentAt: now },
  });

/**
 * Email every confirmed subscriber about one queued listing. Safe to run twice, also at the
 * same time: each email is keyed by listing and subscriber, and the row is marked at the end.
 * DECISION (F07-T2): the alerts template never stores its data, so a failed send is not
 * retried; notifications reports it to staff.
 * @param {string} listingId
 * @param {{ now?: Date }} [context]
 * @returns {Promise<AlertResult>}
 */
export async function sendListingAlert(listingId, { now = new Date() } = {}) {
  const result = { listingId, sent: 0, skipped: 0, failed: 0 };
  // Switched off: nothing is sent and the row is kept.
  if (!(await isEnabled("alerts"))) return { ...result, paused: true };
  const row = await prisma.alertQueue.findUnique({ where: { listingId } });
  if (!row) return result;
  if (row.sentAt) return { ...result, done: true };

  const stale = row.queuedAt.getTime() < now.getTime() - STALE_DAYS * DAY_MS;
  const { state, facts } = await listingState(listingId, now);
  if (state === "waiting" && !stale) return { ...result, waiting: true };
  if (state !== "open" || stale) {
    await markSent(listingId, now);
    return { ...result, dropped: true };
  }

  const base = await storefrontBase();
  const common = {
    count: 1,
    listing_title: facts.title,
    listings: [await alertItem(facts, base)],
    more_count: "",
    browse_url: browseUrl(base),
  };

  let after = null;
  for (;;) {
    const batch = await prisma.alertSubscriber.findMany({
      where: { confirmedAt: { not: null }, unsubscribedAt: null },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      select: { id: true, email: true },
    });
    if (batch.length === 0) break;
    for (const subscriber of batch) {
      // A complaint or hard bounce: the address is suppressed, so it leaves the list too.
      if (await isSuppressed(subscriber.email)) {
        await unsubscribeById(subscriber.id, { via: "SUPPRESSED", now });
        result.skipped += 1;
        continue;
      }
      const { status } = await send(
        "alerts_digest",
        subscriber.email,
        { ...common, unsubscribe_link: unsubscribeUrl(base, subscriber.id) },
        { idempotencyKey: `alerts_new:${listingId}:${subscriber.id}`, now },
      );
      if (status === "SENT") result.sent += 1;
      // Suppressed, or another run already has this key in hand.
      else if (["SUPPRESSED", "SENDING", "PENDING"].includes(status))
        result.skipped += 1;
      else result.failed += 1;
    }
    after = batch[batch.length - 1].id;
  }

  await markSent(listingId, now);
  await writeAudit({
    action: "ListingAlertSent",
    listingId,
    details: {
      sent: result.sent,
      skipped: result.skipped,
      failed: result.failed,
    },
  });
  return result;
}

/**
 * The hourly sweep: send the alerts the immediate send didn't finish (a restart, a timeout, or
 * a listing whose storefront page wasn't ready yet), oldest first.
 * DECISION (F07-T2): switching alerts back on doesn't start a sweep; the next hourly run sends.
 * @param {{ now?: Date }} [context]
 * @returns {Promise<{ listings: number, sent: number, skipped: number, failed: number, paused?: boolean }>}
 */
export async function sendPendingAlerts({ now = new Date() } = {}) {
  const total = { listings: 0, sent: 0, skipped: 0, failed: 0 };
  if (!(await isEnabled("alerts"))) return { ...total, paused: true };
  const rows = await prisma.alertQueue.findMany({
    where: {
      sentAt: null,
      queuedAt: { lt: new Date(now.getTime() - GRACE_MINUTES * MINUTE_MS) },
    },
    orderBy: { queuedAt: "asc" },
    take: SWEEP_LIMIT,
    select: { listingId: true },
  });
  for (const { listingId } of rows) {
    const one = await sendListingAlert(listingId, { now });
    if (one.paused) return { ...total, paused: true };
    total.listings += 1;
    total.sent += one.sent;
    total.skipped += one.skipped;
    total.failed += one.failed;
  }
  return total;
}
