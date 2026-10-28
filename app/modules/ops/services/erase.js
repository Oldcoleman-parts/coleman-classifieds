// Privacy redact (F08-T5): Shopify's customers/redact and shop/redact, through the hook
// platform calls (`onPrivacyRequest`). Each owner anonymises its own rows via its index.js.
// DECISION: a direct hook, not an event: a failure must throw so the webhook answers 500
// and Shopify retries, while the event bus logs and swallows handler failures.
// DECISION: fixed order, the invitation last: the seller's terms acceptances are found
// through their invitations, so a run that fails part way still finds them on the retry.
// Kept: fee charges, photos (normal retention) and audit rows (until retention).
import {
  eraseAllSellers,
  eraseSeller,
  listingIdsForSellerEmail,
} from "@/modules/access/index.js";
import {
  eraseAllSubscribers,
  eraseSubscriber,
} from "@/modules/alerts/index.js";
import { eraseAllBuyers, eraseBuyer } from "@/modules/contact/index.js";
import {
  closeUnusedListing,
  InvalidTransitionError,
  LISTING_EVENTS,
  requireEmail,
  SYSTEM_ACTOR,
  transition,
  ValidationError,
  writeAudit,
} from "@/modules/core/index.js";
import {
  eraseAddress,
  eraseAllAddresses,
} from "@/modules/notifications/index.js";
import {
  eraseListingSellerData,
  eraseTermsNetworkData,
} from "@/modules/workspace/index.js";
import { listingStates } from "./facts.js";

const ACTION = "PrivacyErased";

/**
 * @typedef {{ closed: number, skipped: number, listings: number, invitations: number,
 *   terms: number, messages: number, subscribers: number, outbox: number,
 *   suppressions: number }} EraseCounts
 */

const CLOSE_CHUNK = 500;

/**
 * Closes open listings of an erased seller (F08-FIX-8): an unused INVITED record through
 * core `closeUnusedListing()`, every other open status through `transition(PRIVACY_CLOSE)`
 * (REMOVED, reason PRIVACY_REDACTED: publishing shows the closed page, access closes the
 * link, no email is sent). Terminal and already-closed records are left alone; a listing
 * that moved on meanwhile is `skipped`.
 * @param {Array<{ id: string, status: string, closedAt: Date | null }>} listings
 * @param {Date} now
 * @returns {Promise<{ closed: number, skipped: number }>}
 */
export async function closeListings(listings, now) {
  let closed = 0;
  let skipped = 0;
  for (const { id, status, closedAt } of listings) {
    if (closedAt) continue;
    try {
      if (status === "INVITED") {
        const result = await closeUnusedListing(
          id,
          "PRIVACY_REDACTED",
          SYSTEM_ACTOR,
          { now },
        );
        if (result.closed) closed += 1;
        continue;
      }
      await transition(
        id,
        LISTING_EVENTS.PRIVACY_CLOSE,
        SYSTEM_ACTOR,
        {},
        {
          now,
        },
      );
      closed += 1;
    } catch (error) {
      if (!(error instanceof InvalidTransitionError)) throw error;
      skipped += 1;
    }
  }
  return { closed, skipped };
}

/**
 * @param {string[]} ids
 * @param {Date} now
 */
async function closeSellerListings(ids, now) {
  const totals = { closed: 0, skipped: 0 };
  for (let i = 0; i < ids.length; i += CLOSE_CHUNK) {
    const { closed, skipped } = await closeListings(
      await listingStates(ids.slice(i, i + CLOSE_CHUNK)),
      now,
    );
    totals.closed += closed;
    totals.skipped += skipped;
  }
  return totals;
}

/**
 * Anonymises one customer's seller, buyer and subscriber rows and their emails. Sellers and
 * buyers are matched by email (trimmed, lower case); the Shopify customer id isn't used.
 * The seller's open listings are closed first, then their display name and location are
 * blanked. Repeats change nothing.
 * DECISION (F08-FIX-8): this stays inside the webhook request (a seller has a few listings;
 * each LIVE close is 1–2 s of Shopify calls). Past Shopify's 5 s it retries, which is safe.
 * @param {{ email?: unknown, webhookId?: string, now?: Date }} request
 * @returns {Promise<EraseCounts | null>} null when the payload has no valid email
 */
export async function eraseCustomer({ email, webhookId, now = new Date() }) {
  let address;
  try {
    address = requireEmail(email, "email");
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    // DECISION: nothing can match, so audit and finish (a retry wouldn't help).
    await writeAudit({
      action: ACTION,
      details: { scope: "customer", webhookId, skipped: "no-email" },
    });
    return null;
  }

  const listingIds = await listingIdsForSellerEmail(address);
  const counts = {
    ...(await closeSellerListings(listingIds, now)),
    ...(await eraseListingSellerData(listingIds)),
    ...(await eraseTermsNetworkData(listingIds)),
    ...(await eraseBuyer(address)),
    ...(await eraseSubscriber(address)),
    ...(await eraseAddress(address)),
    ...(await eraseSeller(address)),
  };
  return audited("customer", webhookId, counts);
}

/**
 * Anonymises every seller, buyer and subscriber row and every email (48 hours after an
 * uninstall), after the job closed the open listings (`counts.closed`, `counts.skipped`).
 * Repeats change nothing.
 * @param {{ webhookId?: string, closed?: number, skipped?: number }} [request]
 * @returns {Promise<EraseCounts>}
 */
export async function eraseShop({ webhookId, closed = 0, skipped = 0 } = {}) {
  const counts = {
    closed,
    skipped,
    ...(await eraseListingSellerData("all")),
    ...(await eraseTermsNetworkData("all")),
    ...(await eraseAllBuyers()),
    ...(await eraseAllSubscribers()),
    ...(await eraseAllAddresses()),
    ...(await eraseAllSellers()),
  };
  return audited("shop", webhookId, counts);
}

// One audit entry per request, counts only (never an email), also when all are zero.
async function audited(scope, webhookId, counts) {
  /** @type {EraseCounts} */
  const result = {
    closed: counts.closed,
    skipped: counts.skipped,
    listings: counts.listings,
    invitations: counts.invitations,
    terms: counts.terms,
    messages: counts.messages,
    subscribers: counts.subscribers,
    outbox: counts.outbox,
    suppressions: counts.suppressions,
  };
  await writeAudit({
    action: ACTION,
    details: { scope, webhookId, counts: result },
  });
  return result;
}
