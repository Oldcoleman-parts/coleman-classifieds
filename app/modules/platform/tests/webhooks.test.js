import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { resetDb, prisma } from "@/../tests/db.js";
import {
  handleWebhook,
  onWebhook,
  register as registerPlatform,
} from "@/modules/platform/index.js";
import { resetEventBus } from "@/modules/core/index.js";

const API_SECRET = "test-api-secret";

function createWebhookRequest(body, overrides = {}) {
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
  const hmac = createHmac("sha256", API_SECRET)
    .update(bodyStr, "utf8")
    .digest("base64");

  const headers = {
    "X-Shopify-Hmac-Sha256": hmac,
    "X-Shopify-Topic": "orders/paid",
    "X-Shopify-Shop-Domain": "ocp-dev.myshopify.com",
    "X-Shopify-Webhook-Id": randomBytes(16).toString("hex"),
    "X-Shopify-API-Version": "2024-10",
    "Content-Type": "application/json",
    ...overrides,
  };

  return new Request("https://app.example.test/webhooks/orders/paid", {
    method: "POST",
    headers,
    body: bodyStr,
  });
}

describe("Webhook handling (AC + SEC: HMAC, idempotency, privacy)", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(() => {
    resetEventBus();
  });

  describe("AC + SEC: HMAC verification", () => {
    it("AC + SEC: bad HMAC returns 401", async () => {
      const body = JSON.stringify({ orderId: "123" });
      const request = new Request(
        "https://app.example.test/webhooks/orders/paid",
        {
          method: "POST",
          headers: {
            "X-Shopify-Hmac-Sha256": "wrong-hmac",
            "X-Shopify-Topic": "orders/paid",
            "X-Shopify-Shop-Domain": "ocp-dev.myshopify.com",
            "X-Shopify-Webhook-Id": randomBytes(16).toString("hex"),
            "X-Shopify-API-Version": "2024-10",
          },
          body,
        },
      );

      const response = await handleWebhook(request);
      expect(response.status).toBe(401);

      // No receipt should be created
      const receipt = await prisma.webhookReceipt.findFirst({
        where: { topic: "ORDERS_PAID" },
      });
      expect(receipt).toBeNull();
    });

    it("AC + SEC: missing HMAC header returns 401", async () => {
      const body = JSON.stringify({ orderId: "123" });
      const request = new Request(
        "https://app.example.test/webhooks/orders/paid",
        {
          method: "POST",
          headers: {
            "X-Shopify-Topic": "orders/paid",
            "X-Shopify-Shop-Domain": "ocp-dev.myshopify.com",
            "X-Shopify-Webhook-Id": randomBytes(16).toString("hex"),
            "X-Shopify-API-Version": "2024-10",
          },
          body,
        },
      );

      const response = await handleWebhook(request);
      expect(response.status).toBe(401);
    });

    it("AC: valid HMAC calls handler and returns 200", async () => {
      const body = JSON.stringify({ orderId: "123" });
      const request = createWebhookRequest(body);
      let handlerCalled = false;

      onWebhook("orders/paid", async () => {
        handlerCalled = true;
      });

      const response = await handleWebhook(request);
      expect(response.status).toBe(200);
      expect(handlerCalled).toBe(true);
    });
  });

  describe("AC + SEC: Idempotency", () => {
    it("AC + SEC: duplicate webhook ID is processed only once", async () => {
      const body = JSON.stringify({ orderId: "123" });
      let callCount = 0;

      onWebhook("orders/paid", async () => {
        callCount++;
      });

      const webhookId = randomBytes(16).toString("hex");
      const request1 = new Request(
        "https://app.example.test/webhooks/orders/paid",
        {
          method: "POST",
          headers: {
            "X-Shopify-Hmac-Sha256": createHmac("sha256", API_SECRET)
              .update(body, "utf8")
              .digest("base64"),
            "X-Shopify-Topic": "orders/paid",
            "X-Shopify-Shop-Domain": "ocp-dev.myshopify.com",
            "X-Shopify-Webhook-Id": webhookId,
            "X-Shopify-API-Version": "2024-10",
          },
          body,
        },
      );

      const response1 = await handleWebhook(request1);
      expect(response1.status).toBe(200);
      expect(callCount).toBe(1);

      // Second delivery with same webhook ID
      const request2 = new Request(
        "https://app.example.test/webhooks/orders/paid",
        {
          method: "POST",
          headers: {
            "X-Shopify-Hmac-Sha256": createHmac("sha256", API_SECRET)
              .update(body, "utf8")
              .digest("base64"),
            "X-Shopify-Topic": "orders/paid",
            "X-Shopify-Shop-Domain": "ocp-dev.myshopify.com",
            "X-Shopify-Webhook-Id": webhookId,
            "X-Shopify-API-Version": "2024-10",
          },
          body,
        },
      );

      const response2 = await handleWebhook(request2);
      expect(response2.status).toBe(200);
      expect(callCount).toBe(1); // Still 1, not called again
    });

    it("AC: handler that throws deletes receipt and returns 500", async () => {
      // Clear any previous receipts
      await prisma.webhookReceipt.deleteMany({});

      const body = JSON.stringify({ orderId: "123" });
      const request = createWebhookRequest(body);

      onWebhook("orders/paid", async () => {
        throw new Error("Handler failed");
      });

      const response = await handleWebhook(request);
      expect(response.status).toBe(500);

      // Receipt should be deleted so Shopify retries
      const receipts = await prisma.webhookReceipt.findMany({
        where: { topic: "ORDERS_PAID" },
      });
      expect(receipts).toHaveLength(0);
    });
  });

  describe("SEC: privacy webhooks", () => {
    it.each([
      ["customers/data_request", "privacy.customers_data_request"],
      ["customers/redact", "privacy.customers_redact"],
      ["shop/redact", "privacy.shop_redact"],
    ])("SEC: %s is logged with IDs only", async (topic, action) => {
      registerPlatform();
      const webhookId = randomBytes(16).toString("hex");
      const request = createWebhookRequest(
        {
          shop_domain: "ocp-dev.myshopify.com",
          customer: {
            id: 191167,
            email: "customer@example.test",
            phone: "555-625-1199",
          },
        },
        { "X-Shopify-Topic": topic, "X-Shopify-Webhook-Id": webhookId },
      );

      const response = await handleWebhook(request);

      expect(response.status).toBe(200);
      const audit = await prisma.auditEvent.findFirstOrThrow({
        where: { action },
      });
      expect(audit.details).toEqual({
        shop: "ocp-dev.myshopify.com",
        webhookId,
        customerId: "191167",
      });
    });
  });
});
