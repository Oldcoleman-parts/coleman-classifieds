// The hourly `publishing.reconcile` task: re-write every open listing's page and every
// recently closed one, retry the `listing_live` email, then set `live_count` once.
// DECISION (F06-T2): a full re-sync instead of a "needs sync" column. It repairs a failed
// event handler and an edit made by hand in the Shopify admin, with no schema change; the
// number of listings is small.
import { DAY_MS, HOUR_MS } from "./constants.js";
import { sendLiveEmail } from "./emails.js";
import { findListingsToSync } from "./facts.js";
import { recomputeLiveCount } from "./live-count.js";
import { errorCode, reportPublishingProblem } from "./problems.js";
import { offlineAdmin } from "./shop.js";
import { syncListing } from "./sync.js";

/** How long a closed page keeps being re-written (in case its close handler failed). */
const CLOSED_WINDOW_MS = 2 * DAY_MS;
/** The `listing_live` email is retried for three hours after going live. */
const EMAIL_WINDOW_MS = 4 * HOUR_MS;

/**
 * @param {{ now?: Date }} [context]
 * @returns {Promise<{ synced: number, failed: number, emails: number, liveCount: number | null }>}
 */
export async function runReconcile({ now = new Date() } = {}) {
  const admin = await offlineAdmin();
  const listings = await findListingsToSync(
    new Date(now.getTime() - CLOSED_WINDOW_MS),
  );
  let synced = 0;
  let failed = 0;
  let emails = 0;
  for (const listing of listings) {
    try {
      if (
        (await syncListing(listing.id, { admin, count: false })) !== "SKIPPED"
      )
        synced++;
      if (
        listing.status === "LIVE" &&
        listing.liveAt &&
        now.getTime() - listing.liveAt.getTime() < EMAIL_WINDOW_MS
      ) {
        await sendLiveEmail(listing.id, { admin, now });
        emails++;
      }
    } catch (error) {
      failed++;
      await reportPublishingProblem(
        `sync:${listing.id}`,
        "A listing's storefront page could not be updated.",
        { code: errorCode(error) },
        { listingId: listing.id, now },
      );
    }
  }
  let liveCount = null;
  try {
    liveCount = await recomputeLiveCount({ admin });
  } catch (error) {
    await reportPublishingProblem(
      "live-count",
      "The live listing count for the header button could not be updated.",
      { code: errorCode(error) },
      { now },
    );
  }
  return { synced, failed, emails, liveCount };
}
