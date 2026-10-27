// Shopify's mandatory privacy webhooks. Each request is verified, de-duplicated and logged.
// The app keeps no data keyed by Shopify customer: sellers and buyers are identified by
// email. Row-level redaction is done by the handler ops registers with `onPrivacyRequest()`
// (F08-T5); it throws on failure, so the webhook answers 500 and Shopify retries.
import prisma from "@/db.server";
import { writeAudit } from "@/modules/core/index.js";

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
  // IDs only: the payload also carries the customer's email and phone, which are not kept.
  const customerId = payload?.customer?.id;
  await writeAudit({
    action: ACTIONS[topic],
    details: {
      shop,
      webhookId,
      ...(customerId === undefined ? {} : { customerId: String(customerId) }),
    },
  });

  if (topic === "CUSTOMERS_REDACT")
    await privacyHandler?.({
      kind: "customer",
      email: payload?.customer?.email,
      shop,
      webhookId,
    });

  // 48 hours after an uninstall Shopify asks for the shop's data to be erased.
  if (topic === "SHOP_REDACT") {
    await privacyHandler?.({ kind: "shop", shop, webhookId });
    await prisma.session.deleteMany({ where: { shop } });
  }
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
