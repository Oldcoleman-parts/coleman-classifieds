// The privacy handler ops registers with platform (`onPrivacyRequest`, F08-T5).
import { eraseCustomer } from "./erase.js";
import { enqueueShopRedact } from "./shop-redact.js";

/**
 * A customer redact is done in the request. A shop redact only records a job
 * (`ops.shop-redact` does the work), so the webhook answers at once (F08-FIX-8).
 * @param {import("@/modules/platform/index.js").PrivacyRequest} request
 */
export function handlePrivacyRequest({ kind, email, shop, webhookId }) {
  return kind === "shop"
    ? enqueueShopRedact({ shop, webhookId })
    : eraseCustomer({ email, webhookId });
}
