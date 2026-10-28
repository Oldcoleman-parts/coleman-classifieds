// What the alerts module listens to. No handler throws: a missed alert never undoes a
// listing change. Logs carry ids only.
import prisma from "@/db.server";
import { EVENTS, isEnabled, subscribe } from "@/modules/core/index.js";
import { sendListingAlert } from "./services/send.js";
import { syncSignupVisibility } from "./services/storefront.js";

/** @param {unknown} error */
const code = (error) => error?.code ?? error?.name ?? "Error";

/** Alert sends started by a go-live and not finished yet (see `settleAlertSends`). */
const inFlight = new Set();

/** @param {Promise<unknown>} promise */
function track(promise) {
  inFlight.add(promise);
  promise.finally(() => inFlight.delete(promise));
}

/** Wait for every alert send a go-live started (tests). */
export async function settleAlertSends() {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
}

/**
 * Queue a listing's alert and start sending it. Only a first go-live counts: edits, renewals
 * and a paid overdue listing never do, and the listing id key stops a second entry.
 * DECISION (F07-T2): nothing is queued while alerts are off.
 * DECISION (F07-T2): the send isn't awaited, so a go-live (and the payment webhook behind it)
 * never waits for every subscriber's email; the hourly sweep finishes an interrupted send.
 * @param {{ listingId: string, firstTime: boolean }} payload
 */
export async function enqueueListing({ listingId, firstTime }) {
  if (firstTime !== true || typeof listingId !== "string") return;
  try {
    if (!(await isEnabled("alerts"))) return;
    const { count } = await prisma.alertQueue.createMany({
      data: [{ listingId, queuedAt: new Date() }],
      skipDuplicates: true,
    });
    if (count !== 1) return;
    track(
      sendListingAlert(listingId).catch((error) => {
        console.error(`[alerts] send ${listingId} failed: ${code(error)}`);
      }),
    );
  } catch (error) {
    console.error(`[alerts] queue ${listingId} failed: ${code(error)}`);
  }
}

/**
 * DECISION (F07-T2): the listeners are always registered, because the alerts switch can be
 * flipped while the app runs; every handler and page checks `isEnabled("alerts")` instead.
 */
export function registerListeners() {
  subscribe(EVENTS.ListingWentLive, enqueueListing);
  subscribe(EVENTS.FeatureToggled, async ({ flag }) => {
    if (flag !== "alerts") return;
    try {
      await syncSignupVisibility();
    } catch (error) {
      // The hourly housekeeping task tries again.
      console.error(`[alerts] signup switch sync failed: ${code(error)}`);
    }
  });
}
