// The Phase 2 and Later tasks. They are registered now, so the hourly run already lists
// them, and return straight away while their feature flag is off.
import {
  InvalidTransitionError,
  isEnabled,
  LISTING_EVENTS,
  SYSTEM_ACTOR,
  transition,
} from "@/modules/core/index.js";
import { findListings } from "./facts.js";
import { errorCode } from "./shop.js";

const FLAG_OFF = { skipped: "flag-off" };

/**
 * Close a listing whose renewal payment didn't arrive within the grace period. Core's guard
 * checks `overdueSince + renewalGraceDays`; this only offers the overdue listings.
 * @param {{ now?: Date }} [context]
 */
export async function runRenewalGrace({ now = new Date() } = {}) {
  if (!(await isEnabled("renewals"))) return FLAG_OFF;
  const summary = { expired: 0, waiting: 0, errors: 0 };
  for (const { id } of await findListings({ status: "PAYMENT_OVERDUE" })) {
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
