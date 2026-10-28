// F08-FIX-8: shop/redact answers at once by recording a job; the scheduled task closes the
// open listings, erases the rows, deletes the shop's sessions and marks the job done.
import { describe, it, expect, beforeEach } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import {
  handleWebhook,
  onPrivacyRequest,
  register as registerPlatform,
} from "@/modules/platform/index.js";
import { handlePrivacyRequest } from "@/modules/ops/services/privacy.js";
import { runShopRedact } from "@/modules/ops/services/shop-redact.js";
import { DAY_MS, opsWorld, prisma, rowOf, seedListing } from "./helpers.js";

const SHOP = "ocp-dev.myshopify.com";
const SELLER = "pat.seller@example.test";
const API_SECRET = "test-api-secret";

/** A signed shop/redact delivery. */
function redactShop(webhookId = randomBytes(16).toString("hex")) {
  const body = JSON.stringify({ shop_domain: SHOP });
  return handleWebhook(
    new Request("https://app.example.test/webhooks/shop/redact", {
      method: "POST",
      headers: {
        "X-Shopify-Hmac-Sha256": createHmac("sha256", API_SECRET)
          .update(body, "utf8")
          .digest("base64"),
        "X-Shopify-Topic": "shop/redact",
        "X-Shopify-Shop-Domain": SHOP,
        "X-Shopify-Webhook-Id": webhookId,
        "X-Shopify-API-Version": "2024-10",
        "Content-Type": "application/json",
      },
      body,
    }),
  );
}

const jobs = () => prisma.shopRedactJob.findMany();
const sessionCount = () => prisma.session.count({ where: { shop: SHOP } });

describe("shop/redact as a job (F08-FIX-8)", () => {
  let listing;

  beforeEach(async () => {
    await opsWorld();
    registerPlatform();
    onPrivacyRequest(handlePrivacyRequest);
    listing = await seedListing("LIVE", {
      liveAt: new Date(Date.now() - DAY_MS),
      sellerDisplay: "Pat S.",
      invitation: { sellerEmail: SELLER, sellerName: "Pat Seller" },
    });
    await prisma.session.create({
      data: { id: `${SHOP}_1`, shop: SHOP, state: "", accessToken: "t" },
    });
  });

  it("AC: the webhook answers 200 and only records a job (rows and sessions unchanged)", async () => {
    const before = await rowOf(listing.id);

    const response = await redactShop();

    expect(response.status).toBe(200);
    expect(await rowOf(listing.id)).toEqual(before);
    expect(await sessionCount()).toBe(1);
    const [job] = await jobs();
    expect(job).toMatchObject({ shop: SHOP, doneAt: null });
  });

  it("AC: the task completes the erasure: listings closed, rows erased, sessions deleted, job done", async () => {
    const webhookId = randomBytes(16).toString("hex");
    await redactShop(webhookId);

    const summary = await runShopRedact({});

    expect(summary).toMatchObject({ jobs: 1, done: 1 });
    expect(await rowOf(listing.id)).toMatchObject({
      status: "REMOVED",
      closedReason: "PRIVACY_REDACTED",
    });
    const full = await prisma.listing.findUniqueOrThrow({
      where: { id: listing.id },
    });
    expect(full.sellerDisplay).toBeNull();
    const invitation = await prisma.invitation.findUniqueOrThrow({
      where: { id: full.invitationId },
    });
    expect(invitation.sellerName).toBe("Redacted");
    expect(await sessionCount()).toBe(0);
    expect(
      await prisma.shopRedactJob.findUniqueOrThrow({ where: { webhookId } }),
    ).toMatchObject({
      doneAt: expect.any(Date),
    });
  });

  it("AC: a second run and a repeated webhook change nothing", async () => {
    const webhookId = randomBytes(16).toString("hex");
    await redactShop(webhookId);
    await runShopRedact({});
    const after = await rowOf(listing.id);

    expect((await redactShop(webhookId)).status).toBe(200);
    expect(await jobs()).toHaveLength(1);
    expect(await runShopRedact({})).toMatchObject({ jobs: 0, done: 0 });
    expect(await rowOf(listing.id)).toEqual(after);
  });

  it("AC: with an expired budget the job stays open and nothing is closed", async () => {
    await redactShop();

    const summary = await runShopRedact({ budget: { expired: () => true } });

    expect(summary).toMatchObject({ jobs: 1, done: 0 });
    const [job] = await jobs();
    expect(job.doneAt).toBeNull();
    expect((await rowOf(listing.id)).status).toBe("LIVE");
    expect(await sessionCount()).toBe(1);
  });
});
