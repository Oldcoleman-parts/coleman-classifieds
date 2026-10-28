// F08-FIX-8: a seller's customers/redact closes their open listings through transition() (or
// closeUnusedListing() for an unused INVITED record) and blanks their display name and location.
import { describe, it, expect, beforeEach } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import {
  handleWebhook,
  onPrivacyRequest,
  register as registerPlatform,
} from "@/modules/platform/index.js";
import { handlePrivacyRequest } from "@/modules/ops/services/privacy.js";
import { DAY_MS, opsWorld, prisma, rowOf, seedListing } from "./helpers.js";

const SHOP = "ocp-dev.myshopify.com";
const SELLER = "pat.seller@example.test";
const API_SECRET = "test-api-secret";

/** A signed customers/redact delivery for the seller. */
function redactRequest(email) {
  const body = JSON.stringify({
    shop_domain: SHOP,
    customer: { id: 77, email },
  });
  return new Request("https://app.example.test/webhooks/customers/redact", {
    method: "POST",
    headers: {
      "X-Shopify-Hmac-Sha256": createHmac("sha256", API_SECRET)
        .update(body, "utf8")
        .digest("base64"),
      "X-Shopify-Topic": "customers/redact",
      "X-Shopify-Shop-Domain": SHOP,
      "X-Shopify-Webhook-Id": randomBytes(16).toString("hex"),
      "X-Shopify-API-Version": "2024-10",
      "Content-Type": "application/json",
    },
    body,
  });
}

/** A listing of the seller in `status`, with the personal fields filled in. */
function sellerListing(status, overrides = {}) {
  return seedListing(status, {
    invitation: { sellerEmail: SELLER, sellerName: "Pat Seller" },
    sellerDisplay: "Pat S.",
    city: "Spokane",
    state: "WA",
    ...overrides,
  });
}

describe("Privacy redact closes the seller's listings (F08-FIX-8)", () => {
  beforeEach(async () => {
    await opsWorld();
    registerPlatform();
    onPrivacyRequest(handlePrivacyRequest);
  });

  it.each([
    ["INVITED", { status: "INVITED" }],
    ["DRAFT", {}],
    ["SUBMITTED", {}],
    ["CHANGES_REQUESTED", {}],
    ["APPROVED_AWAITING_PAYMENT", {}],
    ["LIVE", { liveAt: new Date(Date.now() - DAY_MS) }],
    ["PAUSED", { liveAt: new Date(Date.now() - DAY_MS) }],
  ])(
    "AC: %s listing is closed and holds no seller name or location",
    async (status, extra) => {
      const listing = await sellerListing(status, extra);

      const response = await handleWebhook(redactRequest(SELLER));
      expect(response.status).toBe(200);

      const row = await rowOf(listing.id);
      if (status === "INVITED") {
        expect(row).toMatchObject({
          status: "INVITED",
          closedReason: "PRIVACY_REDACTED",
        });
        expect(row.closedAt).toBeInstanceOf(Date);
      } else {
        expect(row).toMatchObject({
          status: "REMOVED",
          closedReason: "PRIVACY_REDACTED",
        });
      }
      const full = await prisma.listing.findUniqueOrThrow({
        where: { id: listing.id },
      });
      expect(full).toMatchObject({
        sellerDisplay: null,
        city: null,
        state: null,
      });
    },
  );

  it("AC: a LIVE listing sends no listing_closed email", async () => {
    await sellerListing("LIVE", { liveAt: new Date(Date.now() - DAY_MS) });

    await handleWebhook(redactRequest(SELLER));

    expect(
      await prisma.emailOutbox.count({
        where: { templateKey: "listing_closed" },
      }),
    ).toBe(0);
  });

  it.each(["SOLD", "EXPIRED", "REMOVED"])(
    "AC: a terminal %s listing keeps its status and close time",
    async (status) => {
      const closedAt = new Date(Date.now() - 2 * DAY_MS);
      const listing = await sellerListing(status, {
        closedAt,
        closedReason: status,
        purgeAfter: new Date(Date.now() + 365 * DAY_MS),
      });

      await handleWebhook(redactRequest(SELLER));

      const row = await rowOf(listing.id);
      expect(row).toMatchObject({ status, closedReason: status });
      expect(row.closedAt).toEqual(closedAt);
    },
  );
});
