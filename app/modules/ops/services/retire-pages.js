// Retire a closed listing's storefront page when photo retention ends (operations.md):
// publishing deletes the entry and redirects its address to the browse page.
import { getSettings, writeAudit } from "@/modules/core/index.js";
import { retireListing } from "@/modules/publishing/index.js";
import { findPagesToRetire, RETIRE_FAILED, RETIRE_HELD } from "./facts.js";
import { DAY_MS, errorCode, offlineAdmin } from "./shop.js";

/** Each retirement is 2–3 Admin calls. */
const BATCH = 20;

/** After this many failed retirements in the window a listing is held and logged. */
const MAX_FAILURES = 3;

/** Failures older than this no longer count, so a held listing is tried again. */
const RETIRE_FAILURE_WINDOW_DAYS = 7;

/**
 * Write an audit entry; a failed write only logs (the next run writes a held entry again).
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
 * DECISION (F08-FIX-4): a held listing is retried once its failures are older than the
 * window. The first hold in a window writes `PageRetireHeld`, which F08-T2 turns into a
 * PUBLISHING incident; `held` stays in the summary (stored in `JobRun.results`) and doesn't
 * fail the task, which would raise a JOB incident instead.
 * @param {{ now?: Date }} [context]
 * @returns {Promise<{ due: number, retired: number, errors: number, held: number }>}
 */
export async function runRetirePages({ now = new Date() } = {}) {
  const { photoRetentionDays } = await getSettings();
  const { due, held, newlyHeld } = await findPagesToRetire(
    new Date(now.getTime() - photoRetentionDays * DAY_MS),
    BATCH,
    {
      maxFailures: MAX_FAILURES,
      windowDays: RETIRE_FAILURE_WINDOW_DAYS,
      now,
    },
  );
  for (const id of held) {
    console.warn(
      `[ops] retire page held for ${id}: failed ${MAX_FAILURES} times in ${RETIRE_FAILURE_WINDOW_DAYS} days`,
    );
  }
  for (const { id, failures } of newlyHeld) {
    await audit(RETIRE_HELD, id, { failures });
  }
  const summary = {
    due: due.length,
    retired: 0,
    errors: 0,
    held: held.length,
  };
  if (due.length === 0) return summary;
  const admin = await offlineAdmin();
  for (const { id } of due) {
    try {
      if ((await retireListing(id, { admin })).deleted) summary.retired += 1;
    } catch (error) {
      summary.errors += 1;
      const code = errorCode(error);
      console.error(`[ops] retire page failed for ${id}: ${code}`);
      await audit(RETIRE_FAILED, id, { code });
    }
  }
  return summary;
}
