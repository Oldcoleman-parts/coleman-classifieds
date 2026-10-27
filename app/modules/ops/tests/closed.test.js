import { describe, it, expect, beforeEach } from "vitest";
import {
  runMonthExpiry,
  runDraftExpiry,
} from "@/modules/ops/services/deadlines.js";
import { runClosedEmails } from "@/modules/ops/services/closed-email.js";
import { runRetirePages } from "@/modules/ops/services/retire-pages.js";
import {
  closedAudits,
  closedEmails,
  DAY_MS,
  opsWorld,
  seedListing,
} from "./helpers.js";

describe("listing_closed email and page retirement (F08-T1)", () => {
  let shopify;

  beforeEach(async () => {
    ({ shopify } = await opsWorld());
  });

  it("AC: an expiry sends exactly one listing_closed (EXPIRED), even after the backstop runs", async () => {
    const listing = await seedListing("LIVE", {
      liveAt: new Date(Date.now() - 40 * DAY_MS),
      expiresAt: new Date(Date.now() - DAY_MS),
    });
    await runMonthExpiry();
    await runClosedEmails();
    await runClosedEmails();
    const emails = await closedEmails();
    expect(emails).toHaveLength(1);
    expect(emails[0].idempotencyKey).toContain(listing.id);
    expect(await closedAudits(listing.id)).toHaveLength(1);
  });

  it("AC: a draft expiry sends no listing_closed", async () => {
    await seedListing("DRAFT", { draftDueBy: new Date(Date.now() - DAY_MS) });
    await runDraftExpiry();
    await runClosedEmails();
    expect(await closedEmails()).toHaveLength(0);
  });

  it("AC: a SOLD page closed past photo retention is retired once, and a second run does nothing", async () => {
    await seedListing("SOLD", {
      closedAt: new Date(Date.now() - 100 * DAY_MS),
      closedReason: "SOLD",
      metaobjectGid: "gid://shopify/Metaobject/9",
      metaobjectHandle: "lantern-9",
    });
    const first = await runRetirePages();
    await runRetirePages();
    expect(first.retired).toBe(1);
    expect(shopify.of("RedirectCreate")).toHaveLength(1);
    expect(shopify.of("ListingDelete")).toHaveLength(1);
  });

  it("AC: a SOLD page closed recently is left alone", async () => {
    await seedListing("SOLD", {
      closedAt: new Date(Date.now() - DAY_MS),
      closedReason: "SOLD",
      metaobjectGid: "gid://shopify/Metaobject/10",
      metaobjectHandle: "lantern-10",
    });
    const summary = await runRetirePages();
    expect(summary.due).toBe(0);
    expect(shopify.of("ListingDelete")).toHaveLength(0);
  });
});
