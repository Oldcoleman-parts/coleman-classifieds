// The deadlines that close a listing: the draft, the correction and the listing month.
// Core decides (each EXPIRE rule has its own guard); these tasks only find the listings that
// are due and ask. Two runs have the effect of one: an expired listing is no longer found.
import {
  InvalidTransitionError,
  LISTING_EVENTS,
  SYSTEM_ACTOR,
  transition,
} from "@/modules/core/index.js";
import { listingPages } from "./facts.js";
import { errorCode } from "./shop.js";

/**
 * @param {string} task for the log
 * @param {import("@prisma/client").Prisma.ListingWhereInput} where
 * @param {string} field the deadline, oldest first
 * @param {Date} now
 * @returns {Promise<{ expired: number, skipped: number, errors: number }>}
 */
async function expireDue(task, where, field, now) {
  const summary = { expired: 0, skipped: 0, errors: 0 };
  for await (const listings of listingPages(where, field)) {
    for (const { id } of listings) {
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

/** A draft not submitted by `draftDueBy`. @param {{ now?: Date }} [context] */
export const runDraftExpiry = ({ now = new Date() } = {}) =>
  expireDue(
    "draft expiry",
    { status: "DRAFT", draftDueBy: { lte: now } },
    "draftDueBy",
    now,
  );

/** Changes requested and not sent back by `correctionDueBy`. @param {{ now?: Date }} [context] */
export const runCorrectionExpiry = ({ now = new Date() } = {}) =>
  expireDue(
    "correction expiry",
    { status: "CHANGES_REQUESTED", correctionDueBy: { lte: now } },
    "correctionDueBy",
    now,
  );

/**
 * The end of the listing month. A paused listing doesn't expire until it is resumed, and a
 * listing with renewal on is left to renewals (core's guard says the same).
 * @param {{ now?: Date }} [context]
 */
export const runMonthExpiry = ({ now = new Date() } = {}) =>
  expireDue(
    "month expiry",
    { status: "LIVE", renewalOn: false, expiresAt: { lte: now } },
    "expiresAt",
    now,
  );
