// Privacy redact (F08-T5): customers/redact and shop/redact, sent as signed webhooks through
// handleWebhook, erase the seller, buyer, subscriber, outbox and suppression rows.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { makeListing } from "@/../tests/factories.js";
import { prisma, resetDb } from "@/../tests/db.js";
import { resetEventBus } from "@/modules/core/index.js";
import {
  handleWebhook,
  onPrivacyRequest,
  register as registerPlatform,
} from "@/modules/platform/index.js";
import { eraseCustomer, register as registerOps } from "@/modules/ops/index.js";
import { register as registerScheduler } from "@/modules/scheduler/index.js";

const SHOP = "ocp-dev.myshopify.com";
const API_SECRET = "test-api-secret";

/** A signed webhook request. Each call builds a new Request (a body can be read once). */
function createWebhookRequest(topicHeader, body, webhookId, shop = SHOP) {
  const bodyStr = JSON.stringify(body);
  const hmac = createHmac("sha256", API_SECRET)
    .update(bodyStr, "utf8")
    .digest("base64");
  return new Request("https://app.example.test/webhooks/privacy", {
    method: "POST",
    headers: {
      "X-Shopify-Hmac-Sha256": hmac,
      "X-Shopify-Topic": topicHeader,
      "X-Shopify-Shop-Domain": shop,
      "X-Shopify-Webhook-Id": webhookId,
      "X-Shopify-API-Version": "2024-10",
      "Content-Type": "application/json",
    },
    body: bodyStr,
  });
}

const redactCustomer = (email, webhookId = randomBytes(16).toString("hex")) =>
  handleWebhook(
    createWebhookRequest(
      "customers/redact",
      {
        shop_domain: SHOP,
        customer: { id: 1001, email, phone: "+15555550199" },
      },
      webhookId,
    ),
  );

const redactShop = (webhookId = randomBytes(16).toString("hex")) =>
  handleWebhook(
    createWebhookRequest("shop/redact", { shop_domain: SHOP }, webhookId),
  );

/** Seller (invitation, listing, terms), buyer message, subscriber, outbox and suppression for one email. */
async function seedCustomer(email, tag) {
  const listing = await makeListing({
    status: "LIVE",
    invitation: {
      sellerEmail: email,
      sellerName: `Name ${tag}`,
      sellerPhone: `+1555555${tag}`,
    },
  });
  const terms = await prisma.termsAcceptance.create({
    data: {
      listingId: listing.id,
      rulesVersion: "2026-01",
      ip: `203.0.113.${tag}`,
      userAgent: `UA-${tag}`,
    },
  });
  const message = await prisma.buyerMessage.create({
    data: {
      listingId: listing.id,
      buyerName: `Buyer ${tag}`,
      buyerEmail: email,
      body: `Is it still available? ${tag}`,
      ip: `198.51.100.${tag}`,
      status: "HELD",
      holdReasons: ["LINK"],
    },
  });
  const subscriber = await prisma.alertSubscriber.create({
    data: {
      email,
      confirmedAt: new Date(),
      unsubscribeTokenHash: `unsub-${tag}`,
    },
  });
  const outboxTo = await prisma.emailOutbox.create({
    data: {
      templateKey: "listing_closed",
      stream: "transactional",
      toAddress: email,
      status: "SENT",
      idempotencyKey: `to-${tag}`,
    },
  });
  const outboxReply = await prisma.emailOutbox.create({
    data: {
      templateKey: "buyer_message",
      stream: "transactional",
      toAddress: `other-${tag}@example.test`,
      replyTo: email,
      status: "SENT",
      idempotencyKey: `reply-${tag}`,
    },
  });
  const suppression = await prisma.emailSuppression.create({
    data: { email, reason: "BOUNCE" },
  });
  return {
    listingId: listing.id,
    invitationId: listing.invitationId,
    termsId: terms.id,
    messageId: message.id,
    subscriberId: subscriber.id,
    outboxIds: [outboxTo.id, outboxReply.id],
    suppressionEmail: suppression.email,
  };
}

/** Every row of one seeded customer, as it is now. */
function rowsOf(ids) {
  return Promise.all([
    prisma.invitation.findUnique({ where: { id: ids.invitationId } }),
    prisma.termsAcceptance.findUnique({ where: { id: ids.termsId } }),
    prisma.buyerMessage.findUnique({ where: { id: ids.messageId } }),
    prisma.alertSubscriber.findUnique({ where: { id: ids.subscriberId } }),
    prisma.emailOutbox.findMany({
      where: { id: { in: ids.outboxIds } },
      orderBy: { id: "asc" },
    }),
    prisma.emailSuppression.findUnique({
      where: { email: ids.suppressionEmail },
    }),
  ]);
}

/** The PrivacyErased audit entry of one webhook delivery. */
const erasedFor = (webhookId) =>
  prisma.auditEvent.findMany({
    where: {
      action: "PrivacyErased",
      details: { path: ["webhookId"], equals: webhookId },
    },
  });

describe("Privacy redact erasure (F08-T5)", () => {
  beforeEach(async () => {
    await resetDb();
    resetEventBus();
    registerScheduler();
    registerPlatform();
    registerOps();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("AC: customers/redact anonymises that customer's rows and leaves other customers alone", async () => {
    const a = await seedCustomer("seller@example.test", "1");
    const b = await seedCustomer("other@example.test", "2");
    const bBefore = await rowsOf(b);

    const response = await redactCustomer("Seller@Example.test");
    expect(response.status).toBe(200);

    const [invitation, terms, message, subscriber, outbox, suppression] =
      await rowsOf(a);
    expect(invitation).toMatchObject({
      sellerName: "Redacted",
      sellerEmail: `redacted+${a.invitationId}@invalid`,
      sellerPhone: null,
    });
    expect(terms).toMatchObject({ ip: "", userAgent: "" });
    expect(message).toMatchObject({
      buyerName: "",
      buyerEmail: "",
      body: "",
      ip: "",
      status: "HELD",
    });
    expect(subscriber).toBeNull();
    expect(outbox).toEqual([]);
    expect(suppression).toBeNull();

    expect(await rowsOf(b)).toEqual(bBefore);
  });

  it("AC: shop/redact anonymises every row and deletes the shop's sessions", async () => {
    const a = await seedCustomer("seller@example.test", "1");
    const b = await seedCustomer("other@example.test", "2");
    await prisma.session.create({
      data: { id: `${SHOP}_1`, shop: SHOP, state: "", accessToken: "t" },
    });
    await prisma.session.create({
      data: {
        id: "other-shop_1",
        shop: "other-shop.myshopify.com",
        state: "",
        accessToken: "t",
      },
    });

    const response = await redactShop();
    expect(response.status).toBe(200);

    for (const ids of [a, b]) {
      const [invitation, terms, message, subscriber, outbox, suppression] =
        await rowsOf(ids);
      expect(invitation.sellerName).toBe("Redacted");
      expect(invitation.sellerEmail).toBe(
        `redacted+${ids.invitationId}@invalid`,
      );
      expect(terms).toMatchObject({ ip: "", userAgent: "" });
      expect(message).toMatchObject({
        buyerName: "",
        buyerEmail: "",
        body: "",
      });
      expect(subscriber).toBeNull();
      expect(outbox).toEqual([]);
      expect(suppression).toBeNull();
    }
    expect(await prisma.session.count({ where: { shop: SHOP } })).toBe(0);
    expect(
      await prisma.session.count({
        where: { shop: "other-shop.myshopify.com" },
      }),
    ).toBe(1);
  });

  it("AC: a repeated webhook id changes nothing and writes no second PrivacyErased entry", async () => {
    await seedCustomer("seller@example.test", "1");
    const webhookId = randomBytes(16).toString("hex");

    expect(
      (await redactCustomer("seller@example.test", webhookId)).status,
    ).toBe(200);
    const once = await erasedFor(webhookId);
    expect(once).toHaveLength(1);

    expect(
      (await redactCustomer("seller@example.test", webhookId)).status,
    ).toBe(200);
    expect(await erasedFor(webhookId)).toHaveLength(1);
  });

  it("AC: a new webhook id for an already-erased email changes no row and counts zero", async () => {
    const a = await seedCustomer("seller@example.test", "1");
    await redactCustomer("seller@example.test");
    const before = await rowsOf(a);

    const webhookId = randomBytes(16).toString("hex");
    expect(
      (await redactCustomer("seller@example.test", webhookId)).status,
    ).toBe(200);

    expect(await rowsOf(a)).toEqual(before);
    const [entry] = await erasedFor(webhookId);
    expect(entry.details.counts).toEqual({
      invitations: 0,
      terms: 0,
      messages: 0,
      subscribers: 0,
      outbox: 0,
      suppressions: 0,
    });
  });

  it("SEC: PrivacyErased details never contain an email address", async () => {
    await seedCustomer("seller@example.test", "1");
    const webhookId = randomBytes(16).toString("hex");
    await redactCustomer("seller@example.test", webhookId);

    const [entry] = await erasedFor(webhookId);
    expect(JSON.stringify(entry.details)).not.toContain("@");
  });

  it.each([
    ["an empty email", ""],
    ["a malformed email", "not-an-email"],
    ["no email", undefined],
  ])(
    "SEC: %s answers 200 and audits a skipped erasure",
    async (_label, email) => {
      const webhookId = randomBytes(16).toString("hex");
      const response = await handleWebhook(
        createWebhookRequest(
          "customers/redact",
          { shop_domain: SHOP, customer: { id: 1001, email } },
          webhookId,
        ),
      );
      expect(response.status).toBe(200);

      const [entry] = await erasedFor(webhookId);
      expect(entry.details).toEqual({
        scope: "customer",
        webhookId,
        skipped: "no-email",
      });
      expect(JSON.stringify(entry.details)).not.toContain("@");
    },
  );

  it("SEC: a failed erasure answers 500, and the same webhook id retried erases the rows", async () => {
    const a = await seedCustomer("seller@example.test", "1");
    let calls = 0;
    onPrivacyRequest(async (request) => {
      calls += 1;
      if (calls === 1) throw new Error("simulated failure");
      return eraseCustomer({
        email: request.email,
        webhookId: request.webhookId,
      });
    });
    const webhookId = randomBytes(16).toString("hex");

    const first = await redactCustomer("seller@example.test", webhookId);
    expect(first.status).toBe(500);
    expect(await erasedFor(webhookId)).toHaveLength(0);

    const retry = await redactCustomer("seller@example.test", webhookId);
    expect(retry.status).toBe(200);
    expect(calls).toBe(2);
    expect(await erasedFor(webhookId)).toHaveLength(1);
    const [invitation] = await rowsOf(a);
    expect(invitation.sellerName).toBe("Redacted");
  });

  it("AC: customers/data_request does not call the redact handler", async () => {
    const spy = vi.fn(async () => null);
    onPrivacyRequest(spy);
    await seedCustomer("seller@example.test", "1");

    const response = await handleWebhook(
      createWebhookRequest(
        "customers/data_request",
        {
          shop_domain: SHOP,
          customer: { id: 1001, email: "seller@example.test" },
        },
        randomBytes(16).toString("hex"),
      ),
    );

    expect(response.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });
});
