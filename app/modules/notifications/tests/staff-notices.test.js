import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing, mockSes } from "@/../tests/factories.js";
import {
  getEmailSettings,
  notifyStaff,
  setSesClient,
} from "@/modules/notifications/index.js";
import { getListingSummary } from "@/modules/core/index.js";
import { resetEventBus, publish, EVENTS } from "@/modules/core/index.js";
import { registerListeners } from "@/modules/notifications/events.js";
import { suppress } from "@/modules/notifications/services/suppression.js";

describe("Staff notices (AC + SEC)", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
    process.env.SES_FROM_TRANSACTIONAL = "transactional@example.test";
    process.env.SES_CONFIG_SET_TRANSACTIONAL = "tx-set";
    process.env.OCP_POSTAL_ADDRESS = "123 Main St, Spokane WA";
    process.env.SHOP_DOMAIN = "ocp-dev.myshopify.com";
    process.env.SHOPIFY_API_KEY = "test-key";
    resetEventBus();
    registerListeners();
  });

  afterEach(() => {
    setSesClient(null);
    delete process.env.SES_FROM_TRANSACTIONAL;
    delete process.env.SES_CONFIG_SET_TRANSACTIONAL;
    delete process.env.OCP_POSTAL_ADDRESS;
    delete process.env.SHOP_DOMAIN;
    delete process.env.SHOPIFY_API_KEY;
  });

  it("AC: NEW trigger sends one email with title and review link", async () => {
    const ses = mockSes();
    setSesClient(ses);

    const listing = await makeListing({ title: "Coleman Lantern 1962" });
    await getEmailSettings();
    await prisma.emailSettings.update({
      where: { id: 1 },
      data: { staffNotify: ["staff@example.test"] },
    });

    await notifyStaff(
      "NEW",
      listing,
      "https://ocp-dev.myshopify.com/admin/apps/test-key/app/listings/" +
        listing.id,
    );

    expect(ses.sent).toHaveLength(1);
    const subject = ses.sent[0].input.Content.Simple.Subject.Data;
    expect(subject).toContain("Coleman Lantern 1962");
    const html = ses.sent[0].input.Content.Simple.Body.Html.Data;
    expect(html).toContain("new listing");
    expect(html).toContain(
      `https://ocp-dev.myshopify.com/admin/apps/test-key/app/listings/${listing.id}`,
    );
  });

  it("AC: CORRECTED trigger sends email with corrected change type", async () => {
    const ses = mockSes();
    setSesClient(ses);

    const listing = await makeListing({ title: "Coleman Lantern" });
    await getEmailSettings();
    await prisma.emailSettings.update({
      where: { id: 1 },
      data: { staffNotify: ["staff@example.test"] },
    });

    await notifyStaff(
      "CORRECTED",
      listing,
      `https://ocp-dev.myshopify.com/admin/apps/test-key/app/listings/${listing.id}`,
    );

    expect(ses.sent).toHaveLength(1);
    const html = ses.sent[0].input.Content.Simple.Body.Html.Data;
    expect(html).toContain("corrected");
  });

  it("AC: EDIT trigger sends email with edit change type", async () => {
    const ses = mockSes();
    setSesClient(ses);

    const listing = await makeListing({ title: "Coleman Lantern" });
    await getEmailSettings();
    await prisma.emailSettings.update({
      where: { id: 1 },
      data: { staffNotify: ["staff@example.test"] },
    });

    await notifyStaff(
      "EDIT",
      listing,
      `https://ocp-dev.myshopify.com/admin/apps/test-key/app/listings/${listing.id}`,
    );

    expect(ses.sent).toHaveLength(1);
    const html = ses.sent[0].input.Content.Simple.Body.Html.Data;
    expect(html).toContain("edit");
  });

  it("AC: MESSAGE_HELD trigger sends email with review link to /app/messages", async () => {
    const ses = mockSes();
    setSesClient(ses);

    const listing = await makeListing({ title: "Coleman Lantern" });
    await getEmailSettings();
    await prisma.emailSettings.update({
      where: { id: 1 },
      data: { staffNotify: ["staff@example.test"] },
    });

    await notifyStaff(
      "MESSAGE_HELD",
      listing,
      "https://ocp-dev.myshopify.com/admin/apps/test-key/app/messages",
      {
        reasons: ["LINK"],
      },
    );

    expect(ses.sent).toHaveLength(1);
    const html = ses.sent[0].input.Content.Simple.Body.Html.Data;
    expect(html).toContain(
      "https://ocp-dev.myshopify.com/admin/apps/test-key/app/messages",
    );
    expect(html).toContain("LINK");
  });

  it("AC: no staff address configured → nothing sent", async () => {
    const ses = mockSes();
    setSesClient(ses);

    const listing = await makeListing({ title: "Coleman Lantern" });
    await getEmailSettings();
    // Don't set staffNotify

    const result = await notifyStaff(
      "NEW",
      listing,
      `https://ocp-dev.myshopify.com/admin/apps/test-key/app/listings/${listing.id}`,
    );

    expect(result.sent).toBe(0);
    expect(ses.sent).toHaveLength(0);
  });

  it("AC: two staff addresses → two emails", async () => {
    const ses = mockSes();
    setSesClient(ses);

    const listing = await makeListing({ title: "Coleman Lantern" });
    await getEmailSettings();
    await prisma.emailSettings.update({
      where: { id: 1 },
      data: { staffNotify: ["staff1@example.test", "staff2@example.test"] },
    });

    const result = await notifyStaff(
      "NEW",
      listing,
      `https://ocp-dev.myshopify.com/admin/apps/test-key/app/listings/${listing.id}`,
    );

    expect(result.sent).toBe(2);
    expect(ses.sent).toHaveLength(2);
    expect(ses.sent[0].input.Destination.ToAddresses).toEqual([
      "staff1@example.test",
    ]);
    expect(ses.sent[1].input.Destination.ToAddresses).toEqual([
      "staff2@example.test",
    ]);
  });

  it("AC: suppressed staff address is skipped", async () => {
    const ses = mockSes();
    setSesClient(ses);

    const listing = await makeListing({ title: "Coleman Lantern" });
    await getEmailSettings();
    await suppress("staff1@example.test", "COMPLAINT");
    await prisma.emailSettings.update({
      where: { id: 1 },
      data: { staffNotify: ["staff1@example.test", "staff2@example.test"] },
    });

    const result = await notifyStaff(
      "NEW",
      listing,
      `https://ocp-dev.myshopify.com/admin/apps/test-key/app/listings/${listing.id}`,
    );

    expect(result.sent).toBe(1);
    expect(ses.sent).toHaveLength(1);
    expect(ses.sent[0].input.Destination.ToAddresses).toEqual([
      "staff2@example.test",
    ]);
  });

  it("SEC: MESSAGE_HELD contains only title, link and reason codes (not buyer words)", async () => {
    const ses = mockSes();
    setSesClient(ses);

    const listing = await makeListing({ title: "Coleman Lantern" });
    await getEmailSettings();
    await prisma.emailSettings.update({
      where: { id: 1 },
      data: { staffNotify: ["staff@example.test"] },
    });

    await notifyStaff(
      "MESSAGE_HELD",
      listing,
      "https://ocp-dev.myshopify.com/admin/apps/test-key/app/messages",
      {
        reasons: ["LINK", "buy now http://example.test (not a code)"],
      },
    );

    const html = ses.sent[0].input.Content.Simple.Body.Html.Data;
    expect(html).toContain("LINK");
    expect(html).not.toContain("http://example.test");
  });

  it("AC: getListingSummary returns { id, title, status }", async () => {
    const listing = await makeListing({ title: "Coleman Lantern" });

    const summary = await getListingSummary(listing.id);

    expect(summary).toBeDefined();
    expect(summary.id).toBe(listing.id);
    expect(summary.title).toBe("Coleman Lantern");
    expect(summary.status).toBeTruthy();
  });

  it("AC: getListingSummary returns null for unknown id", async () => {
    const summary = await getListingSummary("unknown-id");

    expect(summary).toBeNull();
  });

  it("AC: four triggers via event bus send emails", async () => {
    const ses = mockSes();
    setSesClient(ses);

    const listing = await makeListing({ title: "Test Listing" });
    await getEmailSettings();
    await prisma.emailSettings.update({
      where: { id: 1 },
      data: { staffNotify: ["staff@example.test"] },
    });

    // Trigger ListingSubmitted NEW
    await publish(EVENTS.ListingSubmitted, {
      listingId: listing.id,
      kind: "NEW",
    });
    expect(ses.sent).toHaveLength(1);

    // Trigger RevisionSubmitted
    ses.sent.length = 0;
    await publish(EVENTS.RevisionSubmitted, {
      listingId: listing.id,
    });
    expect(ses.sent).toHaveLength(1);

    // Trigger BuyerMessageHeld
    ses.sent.length = 0;
    await publish(EVENTS.BuyerMessageHeld, {
      listingId: listing.id,
      messageId: "m1",
      reasons: ["LINK"],
    });
    expect(ses.sent).toHaveLength(1);
  });

  it("AC: review link without SHOP_DOMAIN uses SHOPIFY_APP_URL", async () => {
    delete process.env.SHOP_DOMAIN;
    process.env.SHOPIFY_APP_URL = "https://custom.example.test";

    const ses = mockSes();
    setSesClient(ses);

    const listing = await makeListing({ title: "Test Listing" });
    await getEmailSettings();
    await prisma.emailSettings.update({
      where: { id: 1 },
      data: { staffNotify: ["staff@example.test"] },
    });

    await notifyStaff(
      "NEW",
      listing,
      "https://custom.example.test/app/listings/" + listing.id,
    );

    const html = ses.sent[0].input.Content.Simple.Body.Html.Data;
    expect(html).toContain(
      "https://custom.example.test/app/listings/" + listing.id,
    );

    delete process.env.SHOPIFY_APP_URL;
  });

  it("AC: dedupeKey prevents duplicate sends", async () => {
    const ses = mockSes();
    setSesClient(ses);

    const listing = await makeListing({ title: "Test Listing" });
    await getEmailSettings();
    await prisma.emailSettings.update({
      where: { id: 1 },
      data: { staffNotify: ["staff@example.test"] },
    });

    const path = `https://ocp-dev.myshopify.com/admin/apps/test-key/app/listings/${listing.id}`;
    const dedupeKey = "test-dedupe";

    await notifyStaff("NEW", listing, path, { dedupeKey });
    expect(ses.sent).toHaveLength(1);

    await notifyStaff("NEW", listing, path, { dedupeKey });
    expect(ses.sent).toHaveLength(1);
  });
});
