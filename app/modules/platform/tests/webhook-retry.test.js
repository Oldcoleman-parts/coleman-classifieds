import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { resetDb, prisma } from "@/../tests/db.js";
import { handleWebhook, onWebhook } from "@/modules/platform/index.js";
import { resetWebhookHandlers } from "@/modules/platform/services/webhooks.js";

const API_SECRET = "test-api-secret";
const CLAIM_WINDOW_MS = 60_000;

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

describe("Webhook retry: claim, timeout, re-delivery", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(() => {
    resetWebhookHandlers();
  });

  afterEach(() => {
    resetWebhookHandlers();
  });

  it("AC: First delivery, handler succeeds → 200 and receipt has processedAt set", async () => {
    const body = JSON.stringify({ orderId: "123" });
    const request = createWebhookRequest(body);
    let handlerCalled = false;

    onWebhook("orders/paid", async () => {
      handlerCalled = true;
    });

    const response = await handleWebhook(request);
    expect(response.status).toBe(200);
    expect(handlerCalled).toBe(true);

    const receipt = await prisma.webhookReceipt.findFirstOrThrow({
      where: { topic: "ORDERS_PAID" },
    });
    expect(receipt.processedAt).not.toBeNull();
  });

  it("AC: Repeat of a processed delivery → 200, handler not called", async () => {
    const body = JSON.stringify({ orderId: "456" });
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

    // Verify the receipt is processed
    const receipt = await prisma.webhookReceipt.findUnique({
      where: { id: webhookId },
    });
    expect(receipt.processedAt).not.toBeNull();

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

  it("AC: Unprocessed receipt older than 60s → taken over, handler called, processedAt set", async () => {
    const webhookId = randomBytes(16).toString("hex");
    const staleTime = new Date(Date.now() - CLAIM_WINDOW_MS - 5000);

    // Seed an old unprocessed receipt
    await prisma.webhookReceipt.create({
      data: { id: webhookId, topic: "ORDERS_PAID", receivedAt: staleTime },
    });

    let handlerCalled = false;
    onWebhook("orders/paid", async () => {
      handlerCalled = true;
    });

    const body = JSON.stringify({ orderId: "789" });
    const request = new Request(
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

    const response = await handleWebhook(request);
    expect(response.status).toBe(200);
    expect(handlerCalled).toBe(true);

    const receipt = await prisma.webhookReceipt.findUnique({
      where: { id: webhookId },
    });
    expect(receipt.processedAt).not.toBeNull();
  });

  it("AC: Unprocessed receipt within 60s → 500, handler not called, receipt unchanged", async () => {
    const webhookId = randomBytes(16).toString("hex");
    const freshTime = new Date(Date.now() - 10_000); // 10 seconds ago

    // Seed a fresh unprocessed receipt
    await prisma.webhookReceipt.create({
      data: { id: webhookId, topic: "ORDERS_PAID", receivedAt: freshTime },
    });

    let handlerCalled = false;
    onWebhook("orders/paid", async () => {
      handlerCalled = true;
    });

    const body = JSON.stringify({ orderId: "999" });
    const request = new Request(
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

    const response = await handleWebhook(request);
    expect(response.status).toBe(500);
    expect(handlerCalled).toBe(false);

    const receipt = await prisma.webhookReceipt.findUnique({
      where: { id: webhookId },
    });
    expect(receipt.processedAt).toBeNull();
    expect(receipt.receivedAt).toEqual(freshTime); // Unchanged
  });

  it("AC: Handler throws → 500, claim deleted; next delivery runs handler again", async () => {
    const webhookId = randomBytes(16).toString("hex");
    let callCount = 0;

    onWebhook("orders/paid", async () => {
      callCount++;
      throw new Error("Handler failed");
    });

    const body = JSON.stringify({ orderId: "111" });
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
    expect(response1.status).toBe(500);
    expect(callCount).toBe(1);

    // Receipt should be deleted
    const receipt1 = await prisma.webhookReceipt.findUnique({
      where: { id: webhookId },
    });
    expect(receipt1).toBeNull();

    // Now deliver again - handler should be called again
    onWebhook("orders/paid", async () => {
      callCount++;
    });

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
    expect(callCount).toBe(2);

    const receipt2 = await prisma.webhookReceipt.findUnique({
      where: { id: webhookId },
    });
    expect(receipt2.processedAt).not.toBeNull();
  });

  it("AC: Topic with no handler → 200 and receipt is processed", async () => {
    const webhookId = randomBytes(16).toString("hex");
    const body = JSON.stringify({ data: "test" });
    const bodyStr = body;
    const hmac = createHmac("sha256", API_SECRET)
      .update(bodyStr, "utf8")
      .digest("base64");

    const request = new Request(
      "https://app.example.test/webhooks/orders/paid",
      {
        method: "POST",
        headers: {
          "X-Shopify-Hmac-Sha256": hmac,
          "X-Shopify-Topic": "orders/paid",
          "X-Shopify-Shop-Domain": "ocp-dev.myshopify.com",
          "X-Shopify-Webhook-Id": webhookId,
          "X-Shopify-API-Version": "2024-10",
        },
        body: bodyStr,
      },
    );

    // Don't register a handler for this topic (resetWebhookHandlers called in beforeEach)
    const response = await handleWebhook(request);
    expect(response.status).toBe(200);

    const receipt = await prisma.webhookReceipt.findUnique({
      where: { id: webhookId },
    });
    expect(receipt).not.toBeNull();
    expect(receipt.processedAt).not.toBeNull();
  });

  it("AC: Two deliveries of same id on stale receipt arrive together → handler called once", async () => {
    const webhookId = randomBytes(16).toString("hex");
    const staleTime = new Date(Date.now() - CLAIM_WINDOW_MS - 5000);

    // Seed an old unprocessed receipt
    await prisma.webhookReceipt.create({
      data: { id: webhookId, topic: "ORDERS_PAID", receivedAt: staleTime },
    });

    let handlerCallCount = 0;
    onWebhook("orders/paid", async () => {
      // Add a small delay to increase the chance of concurrent execution
      await new Promise((resolve) => setTimeout(resolve, 10));
      handlerCallCount++;
    });

    const body = JSON.stringify({ orderId: "444" });
    const bodyStr = body;
    const hmac = createHmac("sha256", API_SECRET)
      .update(bodyStr, "utf8")
      .digest("base64");

    const createRequest = () =>
      new Request("https://app.example.test/webhooks/orders/paid", {
        method: "POST",
        headers: {
          "X-Shopify-Hmac-Sha256": hmac,
          "X-Shopify-Topic": "orders/paid",
          "X-Shopify-Shop-Domain": "ocp-dev.myshopify.com",
          "X-Shopify-Webhook-Id": webhookId,
          "X-Shopify-API-Version": "2024-10",
        },
        body: bodyStr,
      });

    // Send both requests together
    const [response1, response2] = await Promise.all([
      handleWebhook(createRequest()),
      handleWebhook(createRequest()),
    ]);

    // One should succeed (200), one should fail (500)
    const statuses = [response1.status, response2.status];
    expect(statuses).toContain(200);
    expect(statuses).toContain(500);

    // Handler should be called exactly once
    expect(handlerCallCount).toBe(1);

    const receipt = await prisma.webhookReceipt.findUnique({
      where: { id: webhookId },
    });
    expect(receipt.processedAt).not.toBeNull();
  });
});
