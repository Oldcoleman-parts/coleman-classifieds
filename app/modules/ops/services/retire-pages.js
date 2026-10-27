// Retire a closed listing's storefront page when photo retention ends (operations.md):
// publishing deletes the entry and redirects its address to the browse page.
import { getSettings } from "@/modules/core/index.js";
import { retireListing } from "@/modules/publishing/index.js";
import { findPagesToRetire } from "./facts.js";
import { DAY_MS, errorCode, offlineAdmin } from "./shop.js";

/** Each retirement is 2–3 Admin calls. */
const BATCH = 20;

/**
 * @param {{ now?: Date }} [context]
 * @returns {Promise<{ due: number, retired: number, errors: number }>}
 */
export async function runRetirePages({ now = new Date() } = {}) {
  const { photoRetentionDays } = await getSettings();
  const due = await findPagesToRetire(
    new Date(now.getTime() - photoRetentionDays * DAY_MS),
    BATCH,
  );
  const summary = { due: due.length, retired: 0, errors: 0 };
  if (due.length === 0) return summary;
  const admin = await offlineAdmin();
  for (const { id } of due) {
    try {
      if ((await retireListing(id, { admin })).deleted) summary.retired += 1;
    } catch (error) {
      summary.errors += 1;
      console.error(`[ops] retire page failed for ${id}: ${errorCode(error)}`);
    }
  }
  return summary;
}
