// The deadlines that close a listing: the draft, the correction and the listing month.
// Core decides (each EXPIRE rule has its own guard); these tasks only find the listings that
// are due and ask. Two runs have the effect of one: an expired listing is no longer found.
import {
  InvalidTransitionError,
  LISTING_EVENTS,
  SYSTEM_ACTOR,
  transition,
} from "@/modules/core/index.js";
import { listingPages, startBudget } from "./facts.js";
import { errorCode } from "./shop.js";

/**
 * @param {string} task for the log
 * @param {import("@prisma/client").Prisma.ListingWhereInput} where
 * @param {string} field the deadline, oldest first
 * @param {Date} now
 * @param {import("./facts.js").Budget} budget checked before each listing
 * @returns {Promise<{ expired: number, skipped: number, errors: number }>}
 */
async function expireDue(task, where, field, now, budget) {
  const summary = { expired: 0, skipped: 0, errors: 0 };
  for await (const listings of listingPages(where, field, { budget })) {
    for (const { id } of listings) {
      if (budget.expired()) break;
      try {
        await transition(id, LISTING_EVENTS.EXPIRE, SYSTEM_ACTOR, {}, { now });
        summary.expired += 1;
      } catch (error) {
        // Moved on since it was read (submitted, paused, renewed): nothing to close.
        if (error instanceof InvalidTransitionError) {
          summary.skipped += 1;
          continue;
        }
        summary.errors += 1;
        console.error(`[ops] ${task} failed for ${id}: ${errorCode(error)}`);
      }
    }
  }
  return summary;
}

/** A draft not submitted by `draftDueBy`. @param {{ now?: Date, budget?: import("./facts.js").Budget }} [context] */
export const runDraftExpiry = ({
  now = new Date(),
  budget = startBudget(),
} = {}) =>
  expireDue(
    "draft expiry",
    { status: "DRAFT", draftDueBy: { lte: now } },
    "draftDueBy",
    now,
    budget,
  );

/** Changes requested and not sent back by `correctionDueBy`. @param {{ now?: Date, budget?: import("./facts.js").Budget }} [context] */
export const runCorrectionExpiry = ({
  now = new Date(),
  budget = startBudget(),
} = {}) =>
  expireDue(
    "correction expiry",
    { status: "CHANGES_REQUESTED", correctionDueBy: { lte: now } },
    "correctionDueBy",
    now,
    budget,
  );

/**
 * The end of the listing month. A paused listing doesn't expire until it is resumed, and a
 * listing with renewal on is left to renewals (core's guard says the same).
 * @param {{ now?: Date, budget?: import("./facts.js").Budget }} [context]
 */
export const runMonthExpiry = ({
  now = new Date(),
  budget = startBudget(),
} = {}) =>
  expireDue(
    "month expiry",
    { status: "LIVE", renewalOn: false, expiresAt: { lte: now } },
    "expiresAt",
    now,
    budget,
  );
