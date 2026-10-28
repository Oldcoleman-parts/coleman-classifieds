import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { resetDb, prisma } from "@/../tests/db.js";
import { handleWebhook, onWebhook } from "@/modules/platform/index.js";

// When set, `authenticate.webhook` rejects with it; otherwise the real HMAC check runs.
const auth = vi.hoisted(() => ({ error: null }));

vi.mock("@/shopify.server", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    authenticate: {
      ...original.authenticate,
      webhook: (request) =>
        auth.error
          ? Promise.reject(auth.error)
          : original.authenticate.webhook(request),
    },
  };
});

const API_SECRET = "test-api-secret";
const BODY = JSON.stringify({
  email: "buyer@example.test",
  note: "PAYLOAD-SENTINEL-7",
});

function request({ webhookId, hmac, method = "POST" }) {
  const signature =
    hmac ??
    createHmac("sha256", API_SECRET).update(BODY, "utf8").digest("base64");
  return new Request("https://app.example.test/webhooks/orders/paid", {
    method,
    headers: {
      ...(signature === "" ? {} : { "X-Shopify-Hmac-Sha256": signature }),
      "X-Shopify-Topic": "orders/paid",
      "X-Shopify-Shop-Domain": "ocp-dev.myshopify.com",
      "X-Shopify-Webhook-Id": webhookId,
      "X-Shopify-API-Version": "2024-10",
    },
    body: method === "POST" ? BODY : undefined,
  });
}

describe("Webhook failure logging (F01-FIX-8)", () => {
  let log;
  let webhookId;

  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(() => {
    auth.error = null;
    webhookId = randomBytes(16).toString("hex");
    onWebhook("orders/paid", async () => {});
    log = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    log.mockRestore();
  });

  /** Exactly one line with the topic and step, and nothing from the request or a message. */
  const oneSafeLine = (step, id) => {
    expect(log).toHaveBeenCalledTimes(1);
    const [line] = log.mock.calls[0];
    expect(line).toContain(`[webhooks] ORDERS_PAID ${id} ${step}`);
    for (const secret of [
      "buyer@example.test",
      "PAYLOAD-SENTINEL-7",
      "MESSAGE-SENTINEL",
      API_SECRET,
      "X-Shopify",
      "ocp-dev.myshopify.com",
      webhookId === id ? "never-matches" : webhookId,
    ])
      expect(line).not.toContain(secret);
    return line;
  };

  it.each([
    ["a bad HMAC", "bm90IHRoZSByaWdodCBzaWduYXR1cmU="],
    ["a missing HMAC", ""],
  ])(
    "AC + SEC: %s answers 401 with one signature line and no ID",
    async (_name, hmac) => {
      const response = await handleWebhook(request({ webhookId, hmac }));
      expect(response.status).toBe(401);
      oneSafeLine("signature", "-");
    },
  );

  it("AC: a wrong method answers 405 with one method line", async () => {
    auth.error = new Response(null, { status: 405 });
    const response = await handleWebhook(request({ webhookId }));
    expect(response.status).toBe(405);
    oneSafeLine("method", "-");
  });

  it("AC: an unexpected error in the signature check answers 500 with its class, not its message", async () => {
    auth.error = new TypeError("MESSAGE-SENTINEL");
    const response = await handleWebhook(request({ webhookId }));
    expect(response.status).toBe(500);
    expect(oneSafeLine("authenticate", "-")).toContain("TypeError");
  });

  it("AC: a busy claim answers 500 with one busy line", async () => {
    await prisma.webhookReceipt.create({
      data: { id: webhookId, topic: "ORDERS_PAID", receivedAt: new Date() },
    });
    const response = await handleWebhook(request({ webhookId }));
    expect(response.status).toBe(500);
    oneSafeLine("busy", webhookId);
  });

  it("AC: a failing handler answers 500 with one handler line", async () => {
    onWebhook("orders/paid", async () => {
      throw new RangeError("MESSAGE-SENTINEL buyer@example.test");
    });
    const response = await handleWebhook(request({ webhookId }));
    expect(response.status).toBe(500);
    expect(oneSafeLine("handler", webhookId)).toContain("RangeError");
  });

  it("a delivery answered 200 writes no log line", async () => {
    const response = await handleWebhook(request({ webhookId }));
    expect(response.status).toBe(200);
    expect(log).not.toHaveBeenCalled();
  });
});
