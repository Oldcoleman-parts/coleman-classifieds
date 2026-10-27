// Retire a closed listing's storefront page when photo retention ends (operations.md):
// publishing deletes the entry and redirects its address to the browse page.
import { getSettings, writeAudit } from "@/modules/core/index.js";
import { retireListing } from "@/modules/publishing/index.js";
import { findPagesToRetire, RETIRE_FAILED } from "./facts.js";
import { DAY_MS, errorCode, offlineAdmin } from "./shop.js";

/** Each retirement is 2–3 Admin calls. */
const BATCH = 20;

/** After this many failed retirements a listing is held and logged instead of retried. */
const MAX_FAILURES = 3;

/**
 * DECISION (F08-FIX-1): a held listing isn't retried automatically; staff act on the log
 * (and, after F08-T2, the PUBLISHING incident).
 * @param {{ now?: Date }} [context]
 * @returns {Promise<{ due: number, retired: number, errors: number, held: number }>}
 */
export async function runRetirePages({ now = new Date() } = {}) {
  const { photoRetentionDays } = await getSettings();
  const { due, held } = await findPagesToRetire(
    new Date(now.getTime() - photoRetentionDays * DAY_MS),
    BATCH,
    { maxFailures: MAX_FAILURES },
  );
  for (const id of held) {
    console.warn(
      `[ops] retire page held for ${id}: failed ${MAX_FAILURES} times`,
    );
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
      try {
        await writeAudit({
          action: RETIRE_FAILED,
          listingId: id,
          details: { code },
        });
      } catch (auditError) {
        console.error(
          `[ops] retire page failure not recorded for ${id}: ${errorCode(auditError)}`,
        );
      }
    }
  }
  return summary;
}
