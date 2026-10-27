// The `listing_closed` email: sold, removed, expired or lapsed.
import { getSellerContacts } from "@/modules/access/index.js";
import { getEmailStatuses, send } from "@/modules/notifications/index.js";
import { listingPages, loadListing, startBudget } from "./facts.js";
import { DAY_MS, errorCode, firstName } from "./shop.js";

// Core's close reason → the template's `close_reason`.
// DECISION (F08-T1): a draft or correction that ran out of time gets no email: the template
// is about a listing that was public, and the seller never finished this one.
const CLOSE_REASONS = {
  SOLD: "SOLD",
  REMOVED: "REMOVED",
  MONTH_ENDED: "EXPIRED",
  RENEWAL_NOT_PAID: "EXPIRED",
  PAYMENT_WINDOW_PASSED: "LAPSED",
};

/** How long after a close the hourly backstop still sends a missed email. */
const BACKSTOP_DAYS = 7;

/**
 * The email's idempotency key, used by the send and the backstop's check (F08-FIX-5).
 * @param {string} listingId
 * @param {Date} closedAt
 */
export function closedEmailKey(listingId, closedAt) {
  return `listing_closed:${listingId}:${closedAt.getTime()}`;
}

/**
 * Send it once per close. Not sensitive, so notifications queues and retries a failed send
 * itself; the key (with `closedAt`) makes a repeat do nothing.
 * @param {string} listingId
 * @param {Map<string, { sellerEmail: string, sellerName: string }>} [contacts] preloaded for a
 *   batch; looked up for this one listing when left out
 * @param {import("./facts.js").OpsListing} [preloaded] the backstop's page row.
 *   DECISION (F08-FIX-5): `closedAt` and `closedReason` don't change after a close, so the
 *   page row is fresh enough and the backstop skips `loadListing()`.
 * @returns {Promise<boolean>} true when an email was handed to notifications
 */
export async function sendClosedEmail(listingId, contacts, preloaded) {
  const listing = preloaded ?? (await loadListing(listingId));
  const reason = listing?.closedReason
    ? CLOSE_REASONS[listing.closedReason]
    : undefined;
  if (!listing?.closedAt || !reason) return false;
  const contact = (contacts ?? (await getSellerContacts([listingId]))).get(
    listingId,
  );
  if (!contact) {
    console.warn(`[ops] listing_closed skipped for ${listingId}: no-contact`);
    return false;
  }
  await send(
    "listing_closed",
    contact.sellerEmail,
    {
      seller_first_name: firstName(contact.sellerName),
      listing_title: listing.title ?? "",
      close_reason: reason,
    },
    {
      idempotencyKey: closedEmailKey(listing.id, listing.closedAt),
    },
  );
  return true;
}

/**
 * The `ListingClosed` listener. Never throws: a missed email never undoes a close, and the
 * hourly task sends it.
 * @param {{ listingId: string }} payload
 */
export async function onListingClosed({ listingId }) {
  try {
    await sendClosedEmail(listingId);
  } catch (error) {
    console.error(
      `[ops] listing_closed failed for ${listingId}: ${errorCode(error)}`,
    );
  }
}

/**
 * Backstop for a listener that failed: every close of the last 7 days, sent once.
 * DECISION (F08-FIX-5): "closed email sent" lives only in notifications' outbox, so each
 * page is checked with one `getEmailStatuses()` call and the listings with any outbox row
 * are left out (notifications retries a failed send itself). The 7-day window stays well
 * under the outbox's 30-day purge.
 * @param {{ now?: Date, budget?: import("./facts.js").Budget }} [context]
 * @returns {Promise<{ checked: number, errors: number, alreadySent: number }>}
 */
export async function runClosedEmails({
  now = new Date(),
  budget = startBudget(),
} = {}) {
  const pages = listingPages(
    {
      closedReason: { in: Object.keys(CLOSE_REASONS) },
      closedAt: {
        gt: new Date(now.getTime() - BACKSTOP_DAYS * DAY_MS),
        lte: now,
      },
    },
    "closedAt",
    { budget },
  );
  const summary = { checked: 0, errors: 0, alreadySent: 0 };
  for await (const page of pages) {
    const statuses = await getEmailStatuses(
      page.map((listing) =>
        closedEmailKey(listing.id, /** @type {Date} */ (listing.closedAt)),
      ),
    );
    const listings = page.filter(
      (listing) =>
        !statuses.has(
          closedEmailKey(listing.id, /** @type {Date} */ (listing.closedAt)),
        ),
    );
    summary.alreadySent += page.length - listings.length;
    if (listings.length === 0) continue;
    // One lookup per page (F08-FIX-3).
    const contacts = await getSellerContacts(listings.map(({ id }) => id));
    for (const listing of listings) {
      const { id } = listing;
      if (budget.expired()) break;
      summary.checked += 1;
      // DECISION (F08-FIX-3): a listing with no contact counts as an error (sendClosedEmail logs it).
      if (!contacts.has(id)) summary.errors += 1;
      try {
        await sendClosedEmail(id, contacts, listing);
      } catch (error) {
        summary.errors += 1;
        console.error(
          `[ops] listing_closed failed for ${id}: ${errorCode(error)}`,
        );
      }
    }
  }
  return summary;
}
