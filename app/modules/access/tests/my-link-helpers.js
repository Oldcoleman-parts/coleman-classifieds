// Test helpers for the my-link (F04-T3) proxy endpoint: signed requests and setup.
import { createHmac } from "node:crypto";
import { Session } from "@shopify/shopify-api";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { prisma, resetDb } from "@/../tests/db.js";
import { resetRateLimits } from "@/modules/platform/index.js";

export const SHOP = "ocp-dev.myshopify.com";

/** Shopify signs the query: parameters sorted by name, joined as key=value. */
export function signedUrl(path, query = {}) {
  const params = {
    shop: SHOP,
    path_prefix: "/apps/classifieds",
    timestamp: String(Math.floor(Date.now() / 1000)),
    logged_in_customer_id: "",
    ...query,
  };
  const message = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("");
  const signature = createHmac("sha256", process.env.SHOPIFY_API_SECRET)
    .update(message)
    .digest("hex");
  return `https://app.example.test/proxy${path}?${new URLSearchParams({
    ...params,
    signature,
  })}`;
}

/** Reset database, rate limits and install the shop's offline session. */
export async function setUp() {
  await resetDb();
  resetRateLimits();
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
}

/**
 * Call a my-link handler with a proper context and signed request.
 * @param {Function} handler handleMyLinkPage or handleMyLinkRequest
 * @param {Record<string, string | string[]> | null} [fields] form fields (POST); null for GET
 * @param {Record<string, string>} [headers] extra headers (e.g., X-Forwarded-For)
 */
export function callMyLink(handler, fields = null, headers = {}) {
  const url = signedUrl("/my-link");
  let init = { headers };
  if (fields) {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields))
      for (const each of [value].flat()) form.append(name, each);
    init = { method: "POST", body: form, headers };
  }

  const request = new Request(url, init);
  const ctx = {
    shop: SHOP,
    admin: { graphql: () => Promise.resolve({ json: async () => ({}) }) },
    liquid: (body, initResp) =>
      new Response(body, {
        status: initResp?.status ?? 200,
        headers: initResp?.headers ?? {},
      }),
  };

  return handler(ctx, request);
}
