// Shopify's mandatory privacy webhooks. Each request is verified, de-duplicated and logged.
// The app keeps no data keyed by Shopify customer: sellers and buyers are identified by
// invitation and by email relay. Row-level redaction is part of the retention work (F07).
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

  // 48 hours after an uninstall Shopify asks for the shop's data to be erased.
  if (topic === "SHOP_REDACT")
    await prisma.session.deleteMany({ where: { shop } });
}

export const PRIVACY_TOPICS = Object.keys(ACTIONS);
