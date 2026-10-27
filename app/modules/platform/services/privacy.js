// Shopify's mandatory privacy webhooks. Each request is verified, de-duplicated and logged.
// The app keeps no data keyed by Shopify customer: sellers and buyers are identified by
// email. Row-level redaction is done by the handler ops registers with `onPrivacyRequest()`
// (F08-T5); it throws on failure (or when none is registered), so the webhook answers 500
// and Shopify retries.
import prisma from "@/db.server";
import { AppError, writeAudit } from "@/modules/core/index.js";

const ACTIONS = {
  CUSTOMERS_DATA_REQUEST: "privacy.customers_data_request",
  CUSTOMERS_REDACT: "privacy.customers_redact",
  SHOP_REDACT: "privacy.shop_redact",
};

/** @type {import("./webhooks.js").WebhookHandler} */
export async function handlePrivacyWebhook({
  shop,
  topic,
  webhookId,
  payload,
}) {
  if (topic === "CUSTOMERS_REDACT" || topic === "SHOP_REDACT") {
    // F08-FIX-8: a redact with nobody to do it must not be acknowledged.
    if (!privacyHandler)
      throw new AppError("No privacy handler is registered", {
        code: "CONFIG",
      });
    // 48 hours after an uninstall Shopify asks for the shop's data to be erased: ops
    // records a job and deletes the sessions with `deleteShopSessions()` when it is done.
    await privacyHandler(
      topic === "CUSTOMERS_REDACT"
        ? { kind: "customer", email: payload?.customer?.email, shop, webhookId }
        : { kind: "shop", shop, webhookId },
    );
  }

  // IDs only: the payload also carries the customer's email and phone, which are not kept.
  // DECISION (F08-FIX-8): written after the handler, so a failed handler and Shopify's
  // retry don't leave two entries for one request.
  const customerId = payload?.customer?.id;
  await writeAudit({
    action: ACTIONS[topic],
    details: {
      shop,
      webhookId,
      ...(customerId === undefined ? {} : { customerId: String(customerId) }),
    },
  });
}

/**
 * Deletes a shop's sessions: the last step of a shop/redact, run by ops' job.
 * @param {string} shop
 * @returns {Promise<number>}
 */
export async function deleteShopSessions(shop) {
  const { count } = await prisma.session.deleteMany({ where: { shop } });
  return count;
}

/**
 * A redact request passed to the handler. `email` is the payload's text, unchecked.
 * @typedef {{ kind: "customer" | "shop", email?: unknown, shop: string, webhookId: string }} PrivacyRequest
 */

/** @type {((request: PrivacyRequest) => Promise<unknown>) | null} */
let privacyHandler = null;

/**
 * Sets the one handler for `customers/redact` and `shop/redact` (ops, F08-T5). It must be
 * idempotent and throw on failure. `customers/data_request` doesn't call it.
 * @param {(request: PrivacyRequest) => Promise<unknown>} handler
 */
export function onPrivacyRequest(handler) {
  privacyHandler = handler;
}

/** Called by `register()` so a test or reload starts with no handler. */
export function resetPrivacyHandler() {
  privacyHandler = null;
}

export const PRIVACY_TOPICS = Object.keys(ACTIONS);
