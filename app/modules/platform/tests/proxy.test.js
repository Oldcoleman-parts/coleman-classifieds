import { describe, it, expect, beforeAll, vi } from "vitest";
import { createHmac } from "node:crypto";
import { Session } from "@shopify/shopify-api";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { resetDb, prisma } from "@/../tests/db.js";
import { withAppProxy } from "@/modules/platform/index.js";

const SHOP = "ocp-dev.myshopify.com";
const nowSeconds = () => Math.floor(Date.now() / 1000);

// Shopify signs the query: parameters sorted by name, joined as key=value with no separator.
function sign(params) {
  const message = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("");
  return createHmac("sha256", process.env.SHOPIFY_API_SECRET)
    .update(message)
    .digest("hex");
}

function proxyRequest({ signature, ...overrides } = {}) {
  const params = {
    shop: SHOP,
    path_prefix: "/apps/classifieds",
    timestamp: String(nowSeconds()),
    logged_in_customer_id: "",
    ...overrides,
  };
  const query = new URLSearchParams({
    ...params,
    signature: signature ?? sign(params),
  });
  return new Request(`https://app.example.test/proxy/listing?${query}`);
}

describe("App proxy wrapper", () => {
  beforeAll(async () => {
    await resetDb();
    // The app is installed on this shop: an offline session exists.
    await new PrismaSessionStorage(prisma).storeSession(
      new Session({
        id: `offline_${SHOP}`,
        shop: SHOP,
        state: "test-state",
        isOnline: false,
        scope: process.env.SCOPES,
        accessToken: "test-access-token",
      }),
    );
  });

  it.each([
    ["unsigned", () => new Request("https://app.example.test/proxy/listing")],
    ["wrongly signed", () => proxyRequest({ signature: "0".repeat(64) })],
    [
      "stale (older than 90 seconds)",
      () => proxyRequest({ timestamp: String(nowSeconds() - 120) }),
    ],
    [
      "signed for a shop without the app",
      () => proxyRequest({ shop: "other-shop.myshopify.com" }),
    ],
  ])("AC + SEC: a %s request → 401, handler not called", async (_, build) => {
    const handler = vi.fn(() => new Response("ok"));

    const response = await withAppProxy(build(), handler);

    expect(response.status).toBe(401);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(handler).not.toHaveBeenCalled();
  });

  it("AC: a valid signature reaches the handler, and the page is noindex", async () => {
    const handler = vi.fn(() => new Response("ok"));

    const response = await withAppProxy(proxyRequest(), handler);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(handler).toHaveBeenCalledOnce();
    const context = handler.mock.calls[0][0];
    expect(context.shop).toBe(SHOP);
    expect(context.url.pathname).toBe("/proxy/listing");
    expect(typeof context.liquid).toBe("function");
  });

  it("noindex can be switched off for public pages", async () => {
    const response = await withAppProxy(
      proxyRequest(),
      () => new Response("ok"),
      { noindex: false },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Robots-Tag")).toBeNull();
  });
});
