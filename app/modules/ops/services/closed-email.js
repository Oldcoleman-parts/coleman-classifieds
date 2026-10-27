// The `listing_closed` email: sold, removed, expired or lapsed.
import { send } from "@/modules/notifications/index.js";
import { findListings, loadListing } from "./facts.js";
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
 * Send it once per close. Not sensitive, so notifications queues and retries a failed send
 * itself; the key (with `closedAt`) makes a repeat do nothing.
 * @param {string} listingId
 * @returns {Promise<boolean>} true when an email was handed to notifications
 */
export async function sendClosedEmail(listingId) {
  const listing = await loadListing(listingId);
  const reason = listing?.closedReason
    ? CLOSE_REASONS[listing.closedReason]
    : undefined;
  if (!listing?.closedAt || !reason) return false;
  await send(
    "listing_closed",
    listing.invitation.sellerEmail,
    {
      seller_first_name: firstName(listing.invitation.sellerName),
      listing_title: listing.title ?? "",
      close_reason: reason,
    },
    {
      idempotencyKey: `listing_closed:${listing.id}:${listing.closedAt.getTime()}`,
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
 * @param {{ now?: Date }} [context]
 * @returns {Promise<{ checked: number, errors: number }>}
 */
export async function runClosedEmails({ now = new Date() } = {}) {
  const listings = await findListings({
    closedReason: { in: Object.keys(CLOSE_REASONS) },
    closedAt: {
      gt: new Date(now.getTime() - BACKSTOP_DAYS * DAY_MS),
      lte: now,
    },
  });
  const summary = { checked: listings.length, errors: 0 };
  for (const { id } of listings) {
    try {
      await sendClosedEmail(id);
    } catch (error) {
      summary.errors += 1;
      console.error(
        `[ops] listing_closed failed for ${id}: ${errorCode(error)}`,
      );
    }
  }
  return summary;
}
