// Public API of the notifications module. Other modules and routes import only from here.
import { registerTask } from "@/modules/scheduler/index.js";
import { registerListeners } from "./events.js";
import { runOutbox } from "./services/outbox.js";

export { TEMPLATE_KEYS } from "./registry.js";
export { getEmailSettings } from "./services/email-settings.js";
export { send } from "./services/outbox.js";
export { reportEmailProblem } from "./services/problems.js";
export { setSesClient } from "./services/ses-client.js";
export { handleSesWebhook, setSnsFetch } from "./services/sns.js";
export { adminLink, notifyStaff } from "./services/staff-notices.js";
export { isSuppressed } from "./services/suppression.js";
export {
  getTemplate,
  previewTemplate,
  resetTemplate,
  saveTemplate,
} from "./services/templates.js";

/**
 * The hourly email task: retry queued emails, remove finished rows after 30 days, and
 * check the bounce and complaint rates.
 * @param {{ now?: Date }} [context]
 * @returns {Promise<{ sent: number, pending: number, failed: number, purged: number }>}
 */
export function runScheduled(context) {
  return runOutbox(context);
}

/** Called from the app bootstrap, after core and the scheduler. */
export function register() {
  registerListeners();
  registerTask("notifications.retry-outbox", runScheduled);
}
