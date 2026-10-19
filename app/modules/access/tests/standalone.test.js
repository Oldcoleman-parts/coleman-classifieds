import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Session } from "@shopify/shopify-api";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { prisma, resetDb } from "@/../tests/db.js";
import { asSeller, mockSes } from "@/../tests/factories.js";
import { requestEmailCode } from "@/modules/access/index.js";
import { resetRateLimits } from "@/modules/platform/index.js";
import { updateSettings } from "@/modules/core/index.js";
import { setSesClient } from "@/modules/notifications/index.js";
import { loader } from "@/routes/proxy.seller.$token.jsx";
import { action as codeRequest } from "@/routes/proxy.seller.$token_.code-request.jsx";
import { action as codeVerify } from "@/routes/proxy.seller.$token_.code-verify.jsx";

const SHOP = "ocp-dev.myshopify.com";
const STAFF = { type: "STAFF", ref: "staff@example.test" };

function signedRequest(path, init) {
  const { createHmac } = require("node:crypto");
  const params = {
    shop: SHOP,
    path_prefix: "/apps/classifieds",
    timestamp: String(Math.floor(Date.now() / 1000)),
    logged_in_customer_id: "",
  };
  const message = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("");
  const signature = createHmac("sha256", process.env.SHOPIFY_API_SECRET)
    .update(message)
    .digest("hex");
  const query = new URLSearchParams({ ...params, signature });
  return new Request(`https://app.example.test/proxy${path}?${query}`, init);
}

/** Assert that a response is a standalone seller page (reads body once). */
async function expectStandalone(response) {
  const body = await response.text();

  // Headers must be set correctly
  expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");

  // Must start with layout none
  expect(body.trim()).toMatch(/^{%\s*layout\s+none\s*%}/);

  // Must have standalone document structure
  expect(body).toContain("<!doctype html>");
  expect(body).toContain(`lang="en"`);
  expect(body).toContain('charset="utf-8"');
  expect(body).toContain('content="width=device-width, initial-scale=1"');
  expect(body).toContain('name="robots" content="noindex, nofollow"');
  expect(body).toContain('name="referrer" content="no-referrer"');
  expect(body).toContain("<title>");

  // Must not have any <script src> or stylesheet links to another origin
  expect(body).not.toMatch(/<script[^>]+src=/);
  expect(body).not.toMatch(/<link[^>]+rel="?stylesheet"?/);
  expect(body).not.toMatch(/@import\s+["']https?:\/\//);
  expect(body).not.toMatch(/url\s*\(\s*["']?https?:\/\//);

  return body;
}

const codeFrom = (ses) =>
  JSON.stringify(ses.sent.at(-1).input).match(/\b(\d{6})\b/)[1];

describe("AC1: Standalone seller pages", () => {
  let ses;

  beforeEach(async () => {
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
    process.env.SES_FROM_TRANSACTIONAL = "transactional@example.test";
    process.env.SES_CONFIG_SET_TRANSACTIONAL = "tx-set";
    ses = mockSes();
    setSesClient(ses);
    await updateSettings({ emailCodeRequired: true }, STAFF);
  });

  afterEach(() => {
    setSesClient(null);
    delete process.env.SES_FROM_TRANSACTIONAL;
    delete process.env.SES_CONFIG_SET_TRANSACTIONAL;
  });

  it("AC1: code request page starts with {% layout none %} and is standalone", async () => {
    const seller = await asSeller();
    await prisma.listing.create({
      data: { invitationId: seller.invitation.id, arrangements: [] },
    });

    const response = await codeRequest({
      request: signedRequest(`/seller/${seller.token}/code-request`, {
        method: "POST",
        body: new FormData(),
      }),
      params: { token: seller.token },
    });

    const body = await expectStandalone(response);
    expect(body).toContain("Email me a code");
  });

  it.each([
    ["INVALID token", () => "invalid" + Array(44).join("a")],
    [
      "EXPIRED invitation",
      async () => {
        const seller = await asSeller({
          invitation: {
            expiresAt: new Date(Date.now() - 1000),
          },
        });
        return seller.token;
      },
    ],
    [
      "REVOKED invitation",
      async () => {
        const seller = await asSeller({
          invitation: { status: "REVOKED" },
        });
        return seller.token;
      },
    ],
    [
      "CLOSED listing",
      async () => {
        const seller = await asSeller();
        await prisma.listing.create({
          data: {
            invitationId: seller.invitation.id,
            arrangements: [],
            status: "SOLD",
          },
        });
        return seller.token;
      },
    ],
  ])("AC1: %s page is standalone", async (_, makeToken) => {
    const token = await (typeof makeToken === "function"
      ? makeToken()
      : Promise.resolve(makeToken));

    const response = await loader({
      request: signedRequest(`/seller/${token}`),
      params: { token },
    });

    const body = await expectStandalone(response);
    // Should have some error message (the page title or description)
    expect(
      body.match(/doesn't work|expired|withdrawn|ended|listing|link/i),
    ).toBeTruthy();
  });

  it("AC1: code page form is standalone", async () => {
    const seller = await asSeller();
    await prisma.listing.create({
      data: { invitationId: seller.invitation.id, arrangements: [] },
    });
    await requestEmailCode(seller.invitation);

    // The code page is shown by the seller page loader when email codes are required
    const response = await loader({
      request: signedRequest(`/seller/${seller.token}`),
      params: { token: seller.token },
    });

    const body = await expectStandalone(response);
    // Should show the code form (the page gated by email code requirement)
    expect(body).toContain("Email me a code");
  });

  it("AC1: verified page after correct code is standalone", async () => {
    const seller = await asSeller();
    await prisma.listing.create({
      data: { invitationId: seller.invitation.id, arrangements: [] },
    });
    await requestEmailCode(seller.invitation);
    const code = codeFrom(ses);

    const form = new FormData();
    form.set("code", code);

    const response = await codeVerify({
      request: signedRequest(`/seller/${seller.token}/code-verify`, {
        method: "POST",
        body: form,
      }),
      params: { token: seller.token },
    });

    const body = await expectStandalone(response);
    // After verifying the code, user is shown a page to open their listing
    expect(body).toContain("Thanks");
    expect(body).toContain("signed in");
  });

  it("AC1: code-verify with wrong code shows form as standalone", async () => {
    const seller = await asSeller();
    await prisma.listing.create({
      data: { invitationId: seller.invitation.id, arrangements: [] },
    });
    await requestEmailCode(seller.invitation);

    const form = new FormData();
    form.set("code", "999999");

    const response = await codeVerify({
      request: signedRequest(`/seller/${seller.token}/code-verify`, {
        method: "POST",
        body: form,
      }),
      params: { token: seller.token },
    });

    const body = await expectStandalone(response);
    // Should show form again
    expect(body).toContain("Code from the email");
  });

  it("SEC: too many code requests returns 429 standalone", async () => {
    const seller = await asSeller();
    await prisma.listing.create({
      data: { invitationId: seller.invitation.id, arrangements: [] },
    });

    // Max out rate limit
    for (let i = 0; i < 3; i++) {
      await codeRequest({
        request: signedRequest(`/seller/${seller.token}/code-request`, {
          method: "POST",
          body: new FormData(),
        }),
        params: { token: seller.token },
      });
    }

    const response = await codeRequest({
      request: signedRequest(`/seller/${seller.token}/code-request`, {
        method: "POST",
        body: new FormData(),
      }),
      params: { token: seller.token },
    });

    expect(response.status).toBe(429);
    await expectStandalone(response);
  });
});
