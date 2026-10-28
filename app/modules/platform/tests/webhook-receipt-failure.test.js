import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { resetDb, prisma } from "@/../tests/db.js";
import { handleWebhook, onWebhook } from "@/modules/platform/index.js";

// Which receipt writes fail. Spying on a Prisma delegate breaks it, so the client is wrapped.
const failing = vi.hoisted(() => new Set());

vi.mock("@/db.server", async (importOriginal) => {
  const original = await importOriginal();
  const real = original.default;
  const webhookReceipt = new Proxy(real.webhookReceipt, {
    get: (target, key) =>
      failing.has(key)
        ? () => Promise.reject(new Error("Database error"))
        : target[key],
  });
  const client = new Proxy(real, {
    get: (target, key) =>
      key === "webhookReceipt" ? webhookReceipt : target[key],
  });
  return { ...original, default: client };
});

const API_SECRET = "test-api-secret";

function createWebhookRequest(webhookId) {
  const body = JSON.stringify({ orderId: "222" });
  return new Request("https://app.example.test/webhooks/orders/paid", {
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
  });
}

describe("Webhook receipt writes that fail (F01-FIX-2)", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(() => {
    failing.clear();
  });

  it("AC: saving processedAt fails → 500, and the retry after the window runs the handler", async () => {
    const webhookId = randomBytes(16).toString("hex");
    let calls = 0;
    onWebhook("orders/paid", async () => {
      calls++;
    });

    failing.add("upsert");
    const response = await handleWebhook(createWebhookRequest(webhookId));
    expect(response.status).toBe(500);
    expect(calls).toBe(1);

    failing.clear();
    const receipt = await prisma.webhookReceipt.findUnique({
      where: { id: webhookId },
    });
    expect(receipt.processedAt).toBeNull();

    // Inside the claim window the delivery is still taken to be in flight.
    const early = await handleWebhook(createWebhookRequest(webhookId));
    expect(early.status).toBe(500);
    expect(calls).toBe(1);

    await prisma.webhookReceipt.update({
      where: { id: webhookId },
      data: { receivedAt: new Date(Date.now() - 61_000) },
    });
    const retry = await handleWebhook(createWebhookRequest(webhookId));
    expect(retry.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("AC: releasing the claim fails after a throwing handler → still 500, receipt unprocessed", async () => {
    const webhookId = randomBytes(16).toString("hex");
    onWebhook("orders/paid", async () => {
      throw new Error("Handler failed");
    });

    failing.add("deleteMany");
    const response = await handleWebhook(createWebhookRequest(webhookId));
    expect(response.status).toBe(500);

    failing.clear();
    const receipt = await prisma.webhookReceipt.findUnique({
      where: { id: webhookId },
    });
    expect(receipt).not.toBeNull();
    expect(receipt.processedAt).toBeNull();
  });
});
