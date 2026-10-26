import {
  describe,
  it,
  expect,
  afterEach,
  beforeAll,
  beforeEach,
  vi,
} from "vitest";
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
        ? () =>
            Promise.reject(
              Object.assign(new Error("MESSAGE-SENTINEL database error"), {
                code: "P1001",
              }),
            )
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

  let log;

  beforeEach(() => {
    failing.clear();
    log = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    log.mockRestore();
  });

  /** Exactly one line, with the step, and no payload or message text. */
  const oneLine = (step, webhookId) => {
    expect(log).toHaveBeenCalledTimes(1);
    const [line] = log.mock.calls[0];
    expect(line).toContain(`[webhooks] ORDERS_PAID ${webhookId} ${step}`);
    expect(line).toContain("P1001");
    expect(line).not.toMatch(/MESSAGE-SENTINEL|orderId|222|ocp-dev/);
    return line;
  };

  it("AC (F01-FIX-8): a database error in claim() answers 500, is logged once, and leaves no receipt", async () => {
    const webhookId = randomBytes(16).toString("hex");
    let calls = 0;
    onWebhook("orders/paid", async () => {
      calls++;
    });

    failing.add("create");
    const response = await handleWebhook(createWebhookRequest(webhookId));
    expect(response.status).toBe(500);
    expect(calls).toBe(0);
    oneLine("claim", webhookId);
    failing.clear();
    expect(
      await prisma.webhookReceipt.findUnique({ where: { id: webhookId } }),
    ).toBeNull();
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
    oneLine("receipt", webhookId);

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
    // One line for both failures: the handler's and the release's.
    expect(oneLine("handler, claim kept", webhookId)).toContain("Error; ");

    failing.clear();
    const receipt = await prisma.webhookReceipt.findUnique({
      where: { id: webhookId },
    });
    expect(receipt).not.toBeNull();
    expect(receipt.processedAt).toBeNull();
  });
});
