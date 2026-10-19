// Public API of the payments module: the listing fee, from approval to a paid order.
// Other modules and routes import only from here.
import { onWebhook } from "@/modules/platform/index.js";
import { registerTask } from "@/modules/scheduler/index.js";
import { registerListeners } from "./events.js";
import { handleOrderPaid } from "./services/orders-paid.js";
import { handleRefundCreated } from "./services/refunds.js";
import { runFollowUps, runLapse, runReminders } from "./services/tasks.js";

export { handlePay, handlePayPage } from "./services/pay-page.js";
export { ensureFeeSetup, warmUpFeeSetup } from "./services/setup.js";

/**
 * Called from the app bootstrap, after core, platform and the scheduler: the two listeners,
 * the two webhook topics and the three hourly tasks.
 */
export function register() {
  registerListeners();
  onWebhook("orders/paid", handleOrderPaid);
  onWebhook("refunds/create", handleRefundCreated);
  registerTask("payments.approval-follow-up", runFollowUps);
  registerTask("payments.payment-reminder", runReminders);
  registerTask("payments.lapse-unpaid", runLapse);
}
