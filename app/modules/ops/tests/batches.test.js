// F08-FIX-1: every due listing is reached, and a stuck page retirement can't block the batch.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getSettings } from "@/modules/core/index.js";
import { listingPages } from "@/modules/ops/services/facts.js";
import { runDraftReminders } from "@/modules/ops/services/reminders.js";
import { runRetirePages } from "@/modules/ops/services/retire-pages.js";
import {
  DAY_MS,
  failingAdmin,
  opsWorld,
  prisma,
  RETIRE_FAILURES,
  seedListing,
  seedStuckPages,
} from "./helpers.js";

const MINUTE_MS = 60 * 1000;
// Seeding and running 201 listings takes a while on the shared test database.
const SLOW_MS = 120_000;

describe("Job batches reach every due listing (F08-FIX-1)", () => {
  let ses;
  let shopify;
  beforeEach(async () => {
    ({ ses, shopify } = await opsWorld());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("support: listingPages pages past the first page, in deadline order", async () => {
    const now = new Date();
    const seeded = [];
    for (let i = 0; i < 5; i++) {
      seeded.push(
        await seedListing("DRAFT", {
          draftDueBy: new Date(now.getTime() + (5 - i) * MINUTE_MS),
        }),
      );
    }
    const expected = seeded.map(({ id }) => id).reverse();
    const seen = [];
    let pages = 0;
    for await (const page of listingPages({ status: "DRAFT" }, "draftDueBy", {
      pageSize: 2,
    })) {
      pages += 1;
      seen.push(...page.map(({ id }) => id));
    }
    expect(pages).toBe(3);
    expect(seen).toEqual(expected);
  });

  it(
    "AC: with 201 listings past the reminder window where the oldest 200 were already reminded, one run reminds the 201st",
    async () => {
      const now = new Date();
      const { draftReminderDaysBefore: days } = await getSettings();
      const windowEnd = now.getTime() + days * DAY_MS;
      // Oldest 200: deadlines 2 to 201 minutes before the window ends.
      for (let i = 0; i < 200; i++) {
        await seedListing("DRAFT", {
          draftDueBy: new Date(windowEnd - (201 - i) * MINUTE_MS),
        });
      }
      const first = await runDraftReminders({ now });
      expect(first.failed).toBe(0);
      expect(ses.send).toHaveBeenCalledTimes(200);

      // The 201st: newest, and the latest deadline still in the window.
      const latest = await seedListing("DRAFT", {
        draftDueBy: new Date(windowEnd - MINUTE_MS),
      });
      await runDraftReminders({ now });

      expect(ses.send).toHaveBeenCalledTimes(201);
      const row = await prisma.emailOutbox.findUnique({
        where: {
          idempotencyKey: `draft_reminder:${latest.id}:${latest.draftDueBy.getTime()}:0`,
        },
      });
      expect(row?.status).toBe("SENT");
    },
    SLOW_MS,
  );

  it("AC: with 20 listings whose retirement always fails and one more due, a run retires the extra one once the failing ones have reached the limit", async () => {
    const now = new Date();
    const { failing, listings: stuck } = await seedStuckPages(20, now);
    // Closed more recently than the stuck ones, but still past photo retention (90 days).
    const extra = await seedListing("SOLD", {
      closedAt: new Date(now.getTime() - 100 * DAY_MS),
      closedReason: "SOLD",
      metaobjectGid: "gid://shopify/Metaobject/999",
      metaobjectHandle: "lantern-999",
    });
    shopify = failingAdmin(failing);

    for (let run = 1; run <= RETIRE_FAILURES; run++) {
      const summary = await runRetirePages({ now });
      expect(summary).toEqual({ due: 20, retired: 0, errors: 20, held: 0 });
    }
    const fourth = await runRetirePages({ now });
    expect(fourth).toEqual({ due: 1, retired: 1, errors: 0, held: 20 });

    // The stuck ones were tried once per run before the limit, and not after it.
    const deletes = shopify.of("ListingDelete").map(({ id }) => id);
    expect(deletes).toHaveLength(20 * RETIRE_FAILURES + 1);
    for (const { id } of stuck) {
      const rows = await prisma.auditEvent.count({
        where: { listingId: id, action: "PageRetireFailed" },
      });
      expect(rows).toBe(RETIRE_FAILURES);
    }
    const extraRow = await prisma.listing.findUnique({
      where: { id: extra.id },
      select: { metaobjectGid: true },
    });
    expect(extraRow?.metaobjectGid).toBeNull();
  });
});
