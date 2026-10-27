// Public API of the ops module: the time-based rules (deadlines, reminders, page retirement)
// and the Phase 2 / Later task hooks. Other modules and routes import only from here.
import { registerTask } from "@/modules/scheduler/index.js";
import { registerListeners } from "./events.js";
import { runClosedEmails } from "./services/closed-email.js";
import {
  runCorrectionExpiry,
  runDraftExpiry,
  runMonthExpiry,
} from "./services/deadlines.js";
import {
  runRenewalGrace,
  runRenewalReminders,
  runUnverifiedSubmissions,
} from "./services/hooks.js";
import { runDraftReminders, runExpiryReminders } from "./services/reminders.js";
import { runRetirePages } from "./services/retire-pages.js";

export { setOfflineAdmin } from "./services/shop.js";

/**
 * Called from the app bootstrap, after the feature modules: the `ListingClosed` listener
 * and the hourly tasks. Deadlines run before the reminders, so a listing that closes this
 * run gets no reminder.
 */
export function register() {
  registerListeners();
  registerTask("ops.expire-drafts", runDraftExpiry);
  registerTask("ops.expire-corrections", runCorrectionExpiry);
  registerTask("ops.expire-month", runMonthExpiry);
  registerTask("ops.draft-reminders", runDraftReminders);
  registerTask("ops.expiry-reminders", runExpiryReminders);
  registerTask("ops.closed-emails", runClosedEmails);
  registerTask("ops.retire-pages", runRetirePages, { timeoutMs: 120_000 });
  registerTask("renewals.grace-expiry", runRenewalGrace);
  registerTask("renewals.reminders", runRenewalReminders);
  registerTask("open-submissions.unverified", runUnverifiedSubmissions);
}
