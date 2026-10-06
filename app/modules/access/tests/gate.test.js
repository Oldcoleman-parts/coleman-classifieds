import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Session } from "@shopify/shopify-api";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { prisma, resetDb } from "@/../tests/db.js";
import { asSeller, mockSes } from "@/../tests/factories.js";
import {
  checkDeviceCredential,
  issueDeviceCredential,
  requestEmailCode,
  verifyEmailCode,
} from "@/modules/access/index.js";
import { resetRateLimits } from "@/modules/access/services/rate-limit.js";
import { updateSettings } from "@/modules/core/index.js";
import { setSesClient } from "@/modules/notifications/index.js";
import { action, loader } from "@/routes/proxy.seller.$token.jsx";
import { action as codeRequest } from "@/routes/proxy.seller.$token_.code-request.jsx";

const SHOP = "ocp-dev.myshopify.com";
const STAFF = { type: "STAFF", ref: "staff@example.test" };
const DAY_MS = 24 * 60 * 60 * 1000;

// Shopify signs the query: parameters sorted by name, joined as key=value.
function signedRequest(path, init) {
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

const codeFrom = (ses) =>
  JSON.stringify(ses.sent.at(-1).input).match(/\b(\d{6})\b/)[1];

describe("Seller gate (AC + SEC)", () => {
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

  it("AC + SEC: a forwarded link on a new device gets the code page, not the listing", async () => {
    const seller = await asSeller();
    await prisma.listing.create({
      data: { invitationId: seller.invitation.id, arrangements: [] },
    });

    const response = await loader({
      request: signedRequest(`/seller/${seller.token}`),
      params: { token: seller.token },
    });
    const body = await response.text();

    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(body).toContain("Confirm it’s you");
    expect(body).not.toContain("Your listing");
    expect(body).not.toContain(seller.invitation.itemSummary);
  });

  it("AC + SEC: another invitation's device credential doesn't open this listing", async () => {
    const seller = await asSeller();
    await prisma.listing.create({
      data: { invitationId: seller.invitation.id, arrangements: [] },
    });
    const other = await asSeller();
    const form = new FormData();
    form.set("device", issueDeviceCredential(other.invitation.id));

    const response = await action({
      request: signedRequest(`/seller/${seller.token}`, {
        method: "POST",
        body: form,
      }),
      params: { token: seller.token },
    });

    expect(await response.text()).toContain("Confirm it’s you");
  });

  it("AC: the right code gives a credential that opens the listing by POST", async () => {
    const seller = await asSeller();
    await prisma.listing.create({
      data: { invitationId: seller.invitation.id, arrangements: [] },
    });
    await requestEmailCode(seller.invitation);
    const { state, device } = await verifyEmailCode(
      seller.invitation,
      codeFrom(ses),
    );
    const form = new FormData();
    form.set("device", device);

    const response = await action({
      request: signedRequest(`/seller/${seller.token}`, {
        method: "POST",
        body: form,
      }),
      params: { token: seller.token },
    });

    expect(state).toBe("OK");
    expect(await response.text()).toContain("Your listing");
  });

  it.each([
    ["another invitation", (id) => issueDeviceCredential(`${id}x`)],
    [
      "a tampered one",
      (id) => {
        const [payload, signature] = issueDeviceCredential(id).split(".");
        return `${payload}.${signature.slice(0, -2)}AA`;
      },
    ],
    [
      "an expired one",
      (id) =>
        issueDeviceCredential(id, { now: new Date(Date.now() - 31 * DAY_MS) }),
    ],
    ["garbage", () => "not-a-credential"],
  ])("SEC: a device credential from %s is refused", async (_, make) => {
    const seller = await asSeller();
    expect(
      checkDeviceCredential(make(seller.invitation.id), seller.invitation.id),
    ).toBe(false);
    expect(
      checkDeviceCredential(
        issueDeviceCredential(seller.invitation.id),
        seller.invitation.id,
      ),
    ).toBe(true);
  });

  it("AC: when the code email can't be sent, the seller is told and that code never works", async () => {
    ses.send.mockRejectedValue(
      Object.assign(new Error("down"), { name: "ServiceUnavailable" }),
    );
    const seller = await asSeller();

    const result = await requestEmailCode(seller.invitation);
    const row = await prisma.emailCode.findFirst({
      where: { invitationId: seller.invitation.id },
    });

    expect(result.state).toBe("SEND_FAILED");
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect((await verifyEmailCode(seller.invitation, "123456")).state).toBe(
      "NO_CODE",
    );
  });

  it("SEC: a filled honeypot looks like success but sends no code", async () => {
    const seller = await asSeller();
    await prisma.listing.create({
      data: { invitationId: seller.invitation.id, arrangements: [] },
    });
    const form = new FormData();
    form.set("website", "https://spam.example");

    const response = await codeRequest({
      request: signedRequest(`/seller/${seller.token}/code-request`, {
        method: "POST",
        body: form,
      }),
      params: { token: seller.token },
    });

    expect(await response.text()).toContain("We’ve emailed you a code");
    expect(ses.send).not.toHaveBeenCalled();
    expect(await prisma.emailCode.count()).toBe(0);
  });

  it("SEC: too many code requests get a 429", async () => {
    const seller = await asSeller();
    await prisma.listing.create({
      data: { invitationId: seller.invitation.id, arrangements: [] },
    });
    const send = () =>
      codeRequest({
        request: signedRequest(`/seller/${seller.token}/code-request`, {
          method: "POST",
          body: new FormData(),
        }),
        params: { token: seller.token },
      });

    for (let i = 0; i < 3; i += 1) expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
  });
});
