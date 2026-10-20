// Public API of the publishing module: the listing pages on the storefront and the live
// count behind the header button. Other modules and routes import only from here.
import { registerTask } from "@/modules/scheduler/index.js";
import { registerListeners } from "./events.js";
import { runReconcile } from "./services/reconcile.js";

export { resetDefinitionCache } from "./services/definition.js";
export {
  getStorefrontCount,
  recomputeLiveCount,
} from "./services/live-count.js";
export { resetPublishingProblems } from "./services/problems.js";
export { retireListing } from "./services/retire.js";
export { setOfflineAdmin } from "./services/shop.js";
export { syncListing } from "./services/sync.js";

/**
 * The hourly task: re-write open and recently closed pages, retry `listing_live`, set
 * `live_count`.
 * @param {{ now?: Date }} [context]
 * @returns {Promise<{ synced: number, failed: number, emails: number, liveCount: number | null }>}
 */
export function runScheduled(context) {
  return runReconcile(context);
}

/** Called from the app bootstrap, after core, the scheduler and workspace. */
export function register() {
  registerListeners();
  registerTask("publishing.reconcile", runScheduled, { timeoutMs: 120_000 });
}
