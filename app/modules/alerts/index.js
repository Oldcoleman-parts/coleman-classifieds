// Public API of the alerts module (F07-T2): the new-listing alerts signup, an email per new
// listing and the Settings → Alerts screen. Other modules and routes import only from here.
import { registerTask } from "@/modules/scheduler/index.js";
import { registerListeners } from "./events.js";
import { sendPendingAlerts } from "./services/send.js";
import { runHousekeeping } from "./services/housekeeping.js";

/**
 * @typedef {import("@/modules/platform/services/proxy.js").ProxyContext} ProxyContext
 */

export { settleAlertSends } from "./events.js";
export { sendListingAlert, sendPendingAlerts } from "./services/send.js";
export { runHousekeeping } from "./services/housekeeping.js";
export { ALERTS_PATH, setAlertsAdmin } from "./services/links.js";
export {
  handleConfirm,
  handleResubscribe,
  handleSignupPage,
  handleSignupSubmit,
  handleUnsubscribePage,
  handleUnsubscribePost,
} from "./services/pages.js";
export { loadAlertsScreen, streamSubscribersCsv } from "./services/screen.js";
export { syncSignupVisibility } from "./services/storefront.js";
export { subscribe } from "./services/subscribers.js";
export { setTurnstileFetch } from "./services/turnstile.js";

/** Called from the app bootstrap, after core and the scheduler. */
export function register() {
  registerListeners();
  // Hourly; sends the alerts a go-live didn't finish.
  registerTask("alerts.send-pending", sendPendingAlerts, { timeoutMs: 300_000 });
  registerTask("alerts.housekeeping", runHousekeeping);
}
