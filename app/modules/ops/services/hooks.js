// The Phase 2 and Later tasks. They are registered now, so the hourly run already lists
// them, and return straight away while their feature flag is off.
import {
  getSettings,
  InvalidTransitionError,
  isEnabled,
  LISTING_EVENTS,
  SYSTEM_ACTOR,
  transition,
} from "@/modules/core/index.js";
import { listingPages } from "./facts.js";
import { DAY_MS, errorCode } from "./shop.js";

const FLAG_OFF = { skipped: "flag-off" };

/**
 * Close a listing whose renewal payment didn't arrive within the grace period. Core's guard
 * checks `overdueSince + renewalGraceDays`; this only offers the listings past it.
 * DECISION (F08-FIX-1): the query uses whole days; core's guard still decides, so a DST hour
 * at most delays a listing by one run (counted as waiting).
 * @param {{ now?: Date }} [context]
 */
export async function runRenewalGrace({ now = new Date() } = {}) {
  if (!(await isEnabled("renewals"))) return FLAG_OFF;
  const { renewalGraceDays } = await getSettings();
  const summary = { expired: 0, waiting: 0, errors: 0 };
  const pages = listingPages(
    {
      status: "PAYMENT_OVERDUE",
      overdueSince: {
        lte: new Date(now.getTime() - renewalGraceDays * DAY_MS),
      },
    },
    "overdueSince",
  );
  for await (const listings of pages) {
    for (const { id } of listings) {
      try {
        await transition(id, LISTING_EVENTS.EXPIRE, SYSTEM_ACTOR, {}, { now });
        summary.expired += 1;
      } catch (error) {
        // Still inside its grace period.
        if (error instanceof InvalidTransitionError) {
          summary.waiting += 1;
          continue;
        }
        summary.errors += 1;
        console.error(
          `[ops] renewal grace failed for ${id}: ${errorCode(error)}`,
        );
      }
    }
  }
  return summary;
}

/** Renewal reminders: built by F09. */
export async function runRenewalReminders() {
  if (!(await isEnabled("renewals"))) return FLAG_OFF;
  return { skipped: "not-built" };
}

/** Unverified open submissions: built by F10. */
export async function runUnverifiedSubmissions() {
  if (!(await isEnabled("openSubmissions"))) return FLAG_OFF;
  return { skipped: "not-built" };
}
