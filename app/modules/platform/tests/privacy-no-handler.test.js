// F08-FIX-8: a redact topic with no privacy handler registered is not acknowledged: it answers
// 500 (so Shopify retries) and writes no privacy.* audit row.
import { describe, it, expect, beforeEach } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { resetDb, prisma } from "@/../tests/db.js";
import {
  handleWebhook,
  register as registerPlatform,
} from "@/modules/platform/index.js";
import { resetEventBus } from "@/modules/core/index.js";

const SHOP = "ocp-dev.myshopify.com";
const API_SECRET = "test-api-secret";

/** A signed delivery of `topic` with `body`. */
function delivery(topic, body) {
  const bodyStr = JSON.stringify(body);
  return new Request("https://app.example.test/webhooks/privacy", {
    method: "POST",
    headers: {
      "X-Shopify-Hmac-Sha256": createHmac("sha256", API_SECRET)
        .update(bodyStr, "utf8")
        .digest("base64"),
      "X-Shopify-Topic": topic,
      "X-Shopify-Shop-Domain": SHOP,
      "X-Shopify-Webhook-Id": randomBytes(16).toString("hex"),
      "X-Shopify-API-Version": "2024-10",
      "Content-Type": "application/json",
    },
    body: bodyStr,
  });
}

describe("Privacy redact without a handler (F08-FIX-8)", () => {
  beforeEach(async () => {
    await resetDb();
    resetEventBus();
    // register() clears the privacy handler, so nothing is registered here.
    registerPlatform();
  });

  it.each([
    [
      "customers/redact",
      { shop_domain: SHOP, customer: { id: 1, email: "a@example.test" } },
    ],
    ["shop/redact", { shop_domain: SHOP }],
  ])(
    "SEC: %s answers 500 and writes no privacy audit row",
    async (topic, body) => {
      const response = await handleWebhook(delivery(topic, body));

      expect(response.status).toBe(500);
      expect(
        await prisma.auditEvent.count({
          where: { action: { startsWith: "privacy." } },
        }),
      ).toBe(0);
    },
  );
});
