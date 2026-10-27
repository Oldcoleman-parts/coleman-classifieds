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
import { purgeCandidatePages, startBudget } from "./facts.js";
import { errorCode } from "./shop.js";

/** Listings purged per run (each is one transaction). */
const MAX_LISTINGS = 50;

/** The scheduler time box is 300 s; the run stops taking listings after this. */
const BUDGET_MS = 240_000;

/**
 * Deletes one listing and everything that refers to it, in FK order: audit rows first
 * (their FK would set them to null), the invitation after the listing (the listing points
 * at it). Returns null when the listing no longer qualifies under the lock.
 * @param {string} listingId
 * @param {Date} now
 * @returns {Promise<{ auditRows: number } | null>}
 */
function purgeListing(listingId, now) {
  return runAsPurgeRole(async (tx) => {
    const listing = await lockPurgeableListing(tx, listingId, { now });
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
 * the photo task and is counted in `waitingPhotos`; one that fails is logged by id and
 * counted in `failed`, and the run goes on. Then listing-less audit rows past retention.
 * DECISION: `RecordsPurged` (counts only) is written only when something was deleted, so
 * an idle hour adds no row and a second run has no effect.
 * @param {{ now?: Date, budget?: import("./facts.js").Budget }} [context]
 * @returns {Promise<{ listings: number, auditRows: number, globalAuditRows: number,
 *   waitingPhotos: number, failed: number }>}
 */
export async function runPurgeRecords({
  now = new Date(),
  budget = startBudget(BUDGET_MS),
} = {}) {
  const summary = {
    listings: 0,
    auditRows: 0,
    globalAuditRows: 0,
    waitingPhotos: 0,
    failed: 0,
  };

  pages: for await (const page of purgeCandidatePages(now, { budget })) {
    const stored = await listingsWithStoredPhotos(page.map(({ id }) => id));
    for (const { id } of page) {
      if (summary.listings >= MAX_LISTINGS || budget.expired()) break pages;
      if (stored.has(id)) {
        summary.waitingPhotos += 1;
        continue;
      }
      try {
        const result = await purgeListing(id, now);
        if (!result) continue;
        summary.listings += 1;
        summary.auditRows += result.auditRows;
      } catch (error) {
        summary.failed += 1;
        console.error(`[ops] purge failed for ${id}: ${errorCode(error)}`);
      }
    }
  }

  const keepRulesVersions = await referencedRulesVersions();
  summary.globalAuditRows = await runAsPurgeRole((tx) =>
    purgeExpiredAuditEntries(tx, { keepRulesVersions, now }),
  );

  if (summary.listings > 0 || summary.globalAuditRows > 0)
    await writeAudit({ action: "RecordsPurged", details: { ...summary } });
  return summary;
}
