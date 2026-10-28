// Public API of the payments module: the listing fee, from approval to a paid order.
// Other modules and routes import only from here.
import { onWebhook } from "@/modules/platform/index.js";
import { registerTask } from "@/modules/scheduler/index.js";
import { registerListeners } from "./events.js";
import { handleOrderPaid } from "./services/orders-paid.js";
import { handleRefundCreated } from "./services/refunds.js";
import {
  runApplyPaidCharges,
  runFollowUps,
  runLapse,
  runReconcile,
  runReminders,
} from "./services/tasks.js";

export { purgeListingPayments } from "./services/purge.js";
export { handlePay, handlePayPage } from "./services/pay-page.js";
export { ensureFeeSetup, warmUpFeeSetup } from "./services/setup.js";

/**
 * Called from the app bootstrap, after core, platform and the scheduler: the two listeners,
 * the two webhook topics and the five hourly tasks.
 */
export function register() {
  registerListeners();
  onWebhook("orders/paid", handleOrderPaid);
  onWebhook("refunds/create", handleRefundCreated);
  registerTask("payments.approval-follow-up", runFollowUps);
  registerTask("payments.payment-reminder", runReminders);
  // Before the lapse, so a fee whose webhook was lost is found first (F06-FIX-3).
  registerTask("payments.reconcile-paid-orders", runReconcile, {
    timeoutMs: 120_000,
  });
  registerTask("payments.lapse-unpaid", runLapse, { timeoutMs: 120_000 });
  registerTask("payments.apply-paid-charges", runApplyPaidCharges, {
    timeoutMs: 120_000,
  });
}
