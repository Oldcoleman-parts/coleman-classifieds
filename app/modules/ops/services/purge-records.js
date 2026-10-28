// The records purge (F08-T4): a listing's payment, agreement, history, messages and contact
// details go once `purgeAfter` has passed (1 year after close). One transaction per listing
// as the purge role (core `runAsPurgeRole()`); each owner deletes its own rows through its
// index.js. The database trigger refuses any audit row that isn't past retention.
import { purgeInvitation } from "@/modules/access/index.js";
import { purgeListingAlert } from "@/modules/alerts/index.js";
import { purgeListingMessages } from "@/modules/contact/index.js";
import {
  lockPurgeableListing,
  purgeExpiredAuditEntries,
  purgeListingAudit,
  purgeListingCore,
  runAsPurgeRole,
  writeAudit,
} from "@/modules/core/index.js";
import {
  listingsWithStoredPhotos,
  purgeListingPhotos,
} from "@/modules/media/index.js";
import { purgeListingPayments } from "@/modules/payments/index.js";
import {
  purgeListingWorkspace,
  referencedRulesVersions,
} from "@/modules/workspace/index.js";
import {
  databaseNow,
  heldByFailures,
  PURGE_FAILED,
  PURGE_HELD,
  purgeCandidatePages,
  startBudget,
} from "./facts.js";
import { DAY_MS, errorCode } from "./shop.js";

/** Listings purged per run (each is one transaction). */
const MAX_LISTINGS = 50;

/** The scheduler time box is 300 s; the run stops taking listings after this. */
const BUDGET_MS = 240_000;

/** After this many failed purges in the window a listing is held and logged. */
const MAX_FAILURES = 3;

/** Failures older than this no longer count, so a held listing is tried again. */
const PURGE_FAILURE_WINDOW_DAYS = 7;

/**
 * Write an audit entry; a failed write only logs (the next run tries again).
 * @param {string} action
 * @param {string} listingId
 * @param {Record<string, unknown>} details
 */
async function audit(action, listingId, details) {
  try {
    await writeAudit({ action, listingId, details });
  } catch (error) {
    console.error(
      `[ops] ${action} not recorded for ${listingId}: ${errorCode(error)}`,
    );
  }
}

/**
 * Deletes one listing and everything that refers to it, in FK order: audit rows first
 * (their FK would set them to null), the invitation after the listing (the listing points
 * at it). Returns null when the listing no longer qualifies under the lock.
 * @param {string} listingId
 * @returns {Promise<{ auditRows: number } | null>}
 */
function purgeListing(listingId) {
  return runAsPurgeRole(async (tx) => {
    const listing = await lockPurgeableListing(tx, listingId);
    if (!listing) return null;
    const auditRows = await purgeListingAudit(tx, listingId);
    await purgeListingPhotos(tx, listingId);
    await purgeListingWorkspace(tx, listingId);
    await purgeListingPayments(tx, listingId);
    await purgeListingMessages(tx, listingId);
    await purgeListingAlert(tx, listingId);
    await purgeListingCore(tx, listingId);
    await purgeInvitation(tx, listing.invitationId);
    return { auditRows };
  });
}

/**
 * The hourly `ops.purge-records` task. A listing whose photos are still stored waits for
 * the photo task (`waitingPhotos`); one that no longer qualifies under the lock is
 * `skipped`. A failure is rolled back, logged by id, audited as `PurgeFailed` (its error
 * code only) and counted in `failed`; after 3 in 7 days the listing is `held` (left out
 * and logged by id) and the first hold in a window writes one `PurgeHeld`, which F08-T2
 * turns into an incident. Then listing-less audit rows past retention; a failure there is
 * logged and reported as `globalFailed: 1` instead of stopping the run.
 * DECISION (F08-FIX-7): retention follows the database clock (`databaseNow()`, core's
 * lock and the trigger), so the scheduler's `now` isn't used.
 * DECISION (F08-FIX-7): `RecordsPurged` (counts only, all integers) is written after both
 * phases whenever something was deleted or the global step failed, so a purge is never
 * left without a trace; an idle hour adds no row and a second run has no effect.
 * @param {{ budget?: import("./facts.js").Budget }} [context]
 * @returns {Promise<{ listings: number, auditRows: number, globalAuditRows: number,
 *   waitingPhotos: number, failed: number, skipped: number, held: number,
 *   globalFailed: number }>}
 */
export async function runPurgeRecords({
  budget = startBudget(BUDGET_MS),
} = {}) {
  const now = await databaseNow();
  const since = new Date(now.getTime() - PURGE_FAILURE_WINDOW_DAYS * DAY_MS);
  const summary = {
    listings: 0,
    auditRows: 0,
    globalAuditRows: 0,
    waitingPhotos: 0,
    failed: 0,
    skipped: 0,
    held: 0,
    globalFailed: 0,
  };

  pages: for await (const page of purgeCandidatePages(now, { budget })) {
    const ids = page.map(({ id }) => id);
    const stored = await listingsWithStoredPhotos(ids);
    const { held, newlyHeld } = await heldByFailures(ids, {
      failedAction: PURGE_FAILED,
      heldAction: PURGE_HELD,
      maxFailures: MAX_FAILURES,
      since,
    });
    const heldSet = new Set(held);
    for (const { id, failures } of newlyHeld)
      await audit(PURGE_HELD, id, { failures });
    for (const id of ids) {
      if (summary.listings >= MAX_LISTINGS || budget.expired()) break pages;
      if (stored.has(id)) {
        summary.waitingPhotos += 1;
        continue;
      }
      if (heldSet.has(id)) {
        summary.held += 1;
        console.warn(
          `[ops] purge held for ${id}: failed ${MAX_FAILURES} times in ${PURGE_FAILURE_WINDOW_DAYS} days`,
        );
        continue;
      }
      try {
        const result = await purgeListing(id);
        if (!result) {
          summary.skipped += 1;
          continue;
        }
        summary.listings += 1;
        summary.auditRows += result.auditRows;
      } catch (error) {
        summary.failed += 1;
        console.error(`[ops] purge failed for ${id}: ${errorCode(error)}`);
        await audit(PURGE_FAILED, id, { code: errorCode(error) });
      }
    }
  }

  try {
    const keepRulesVersions = await referencedRulesVersions();
    summary.globalAuditRows = await runAsPurgeRole((tx) =>
      purgeExpiredAuditEntries(tx, { keepRulesVersions }),
    );
  } catch (error) {
    summary.globalFailed = 1;
    console.error(`[ops] global audit purge failed: ${errorCode(error)}`);
  }

  if (
    summary.listings > 0 ||
    summary.globalAuditRows > 0 ||
    summary.globalFailed
  )
    await writeAudit({ action: "RecordsPurged", details: { ...summary } });
  return summary;
}
