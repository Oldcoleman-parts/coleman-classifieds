// Public API of the platform module. Other modules import only from here.
import { handlePrivacyWebhook, PRIVACY_TOPICS } from "./services/privacy.js";
import { onWebhook, resetWebhookHandlers } from "./services/webhooks.js";

export {
  adminFor,
  adminGraphql,
  storefrontFor,
  storefrontGraphql,
} from "./services/graphql.js";
export { withAppProxy } from "./services/proxy.js";
export { logRequestError } from "./services/server-errors.js";
export { redactRequestPath } from "./server/request-log.js";
export { handleWebhook, onWebhook } from "./services/webhooks.js";

/**
 * Called from the app bootstrap, before the feature modules, which add their own topics
 * with `onWebhook()` (payments: orders/paid and refunds/create).
 */
export function register() {
  resetWebhookHandlers();
  for (const topic of PRIVACY_TOPICS) onWebhook(topic, handlePrivacyWebhook);
}
