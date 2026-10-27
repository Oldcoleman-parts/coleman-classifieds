// Public API of the platform module. Other modules import only from here.
import {
  handlePrivacyWebhook,
  PRIVACY_TOPICS,
  resetPrivacyHandler,
} from "./services/privacy.js";
import { onWebhook, resetWebhookHandlers } from "./services/webhooks.js";

export {
  adminFor,
  adminGraphql,
  storefrontFor,
  storefrontGraphql,
} from "./services/graphql.js";
export { onPrivacyRequest } from "./services/privacy.js";
export { withAppProxy } from "./services/proxy.js";
export { clientIp, rateLimit, resetRateLimits } from "./services/rate-limit.js";
export { logRequestError } from "./services/server-errors.js";
export { redactRequestPath } from "./server/request-log.js";
export { handleWebhook, onWebhook } from "./services/webhooks.js";

/**
 * Called from the app bootstrap, before the feature modules, which add their own topics
 * with `onWebhook()` (payments: orders/paid and refunds/create). Ops sets the privacy
 * redact handler with `onPrivacyRequest()` (F08-T5).
 */
export function register() {
  resetWebhookHandlers();
  resetPrivacyHandler();
  for (const topic of PRIVACY_TOPICS) onWebhook(topic, handlePrivacyWebhook);
}
