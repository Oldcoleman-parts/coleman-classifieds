// What the publishing module listens to. No handler throws: a Shopify or email problem never
// undoes the listing change, it is reported and the hourly `publishing.reconcile` repairs it.
import { EVENTS, subscribe } from "@/modules/core/index.js";
import { sendLiveEmail, sendRevisionEmail } from "./services/emails.js";
import { errorCode, reportPublishingProblem } from "./services/problems.js";
import { syncAndAudit } from "./services/sync.js";

/**
 * @param {string} reason the event name
 * @param {(payload: any) => Promise<void>} work
 * @returns {(payload: any) => Promise<void>}
 */
const guarded = (reason, work) => async (payload) => {
  try {
    await work(payload);
  } catch (error) {
    const listingId = payload?.listingId ?? null;
    await reportPublishingProblem(
      `${reason}:${listingId}`,
      "A listing's storefront page could not be updated.",
      { event: reason, code: errorCode(error) },
      { listingId },
    );
  }
};

/** @param {string} reason */
const sync = (reason) =>
  guarded(reason, async ({ listingId }) => {
    await syncAndAudit(listingId, reason);
  });

/** Called from `register()`. Must run after workspace's (see app/bootstrap.server.js). */
export function registerListeners() {
  subscribe(
    EVENTS.ListingWentLive,
    guarded("ListingWentLive", async ({ listingId, firstTime }) => {
      await syncAndAudit(listingId, "ListingWentLive");
      // A renewal or a paid overdue listing (Phase 2) is already known to the seller.
      if (firstTime) await sendLiveEmail(listingId);
    }),
  );
  subscribe(EVENTS.ListingUpdatedImmediate, sync("ListingUpdatedImmediate"));
  subscribe(
    EVENTS.RevisionApproved,
    guarded("RevisionApproved", async ({ listingId, revisionId }) => {
      await syncAndAudit(listingId, "RevisionApproved");
      await sendRevisionEmail(listingId, revisionId);
    }),
  );
  subscribe(EVENTS.ListingPaused, sync("ListingPaused"));
  subscribe(EVENTS.ListingResumed, sync("ListingResumed"));
  subscribe(EVENTS.ListingExtended, sync("ListingExtended"));
  subscribe(EVENTS.ListingClosed, sync("ListingClosed"));
}
