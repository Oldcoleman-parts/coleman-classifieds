// F08-FIX-4: a held page retirement is retried once its failures age out, and the hold is
// recorded once per window. The held log names only the listing id.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RETIRE_HELD } from "@/modules/ops/services/facts.js";
import { runRetirePages } from "@/modules/ops/services/retire-pages.js";
import {
  DAY_MS,
  failingAdmin,
  opsWorld,
  prisma,
  RETIRE_FAILURES,
  rowOf,
  seedListing,
  seedStuckPages,
} from "./helpers.js";

const HOUR_MS = 60 * 60 * 1000;

/** A SOLD listing closed 100 days ago, past photo retention (90 days), with a storefront page. */
function seedClosedPage(now) {
  return seedListing("SOLD", {
    closedAt: new Date(now.getTime() - 100 * DAY_MS),
    closedReason: "SOLD",
    metaobjectGid: "gid://shopify/Metaobject/500",
    metaobjectHandle: "lantern-500",
  });
}

/** `count` PageRetireFailed audit rows for a listing, all stamped `at`. */
async function recordFailures(listingId, at, count = RETIRE_FAILURES) {
  for (let i = 0; i < count; i++) {
    await prisma.auditEvent.create({
      data: {
        listingId,
        actor: "SYSTEM",
        action: "PageRetireFailed",
        details: { code: "INTERNAL_ERROR" },
        at,
      },
    });
  }
}

describe("Held page retirements (F08-FIX-4)", () => {
  beforeEach(async () => {
    await opsWorld();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("AC: a listing with 3 failures older than 7 days is offered for retirement again", async () => {
    const now = new Date();
    const listing = await seedClosedPage(now);
    await recordFailures(listing.id, new Date(now.getTime() - 8 * DAY_MS));

    const summary = await runRetirePages({ now });

    expect(summary).toEqual({ due: 1, retired: 1, errors: 0, held: 0 });
    expect((await rowOf(listing.id)).metaobjectGid).toBeNull();
  });

  it("AC: with 3 recent failures a listing is held and one PageRetireHeld entry is written across two runs", async () => {
    const now = new Date();
    const listing = await seedClosedPage(now);
    await recordFailures(listing.id, new Date(now.getTime() - HOUR_MS));

    for (let run = 1; run <= 2; run++) {
      const summary = await runRetirePages({ now });
      expect(summary).toEqual({ due: 0, retired: 0, errors: 0, held: 1 });
    }

    const held = await prisma.auditEvent.findMany({
      where: { listingId: listing.id, action: RETIRE_HELD },
      select: { actor: true, details: true },
    });
    expect(held).toHaveLength(1);
    expect(held[0].details).toEqual({ failures: 3 });
    expect(held[0].actor).toBe("SYSTEM");
  });

  it("SEC: the held log names only the listing id, never the seller's email", async () => {
    const now = new Date();
    const { failing, listings } = await seedStuckPages(1, now);
    const [stuck] = listings;
    failingAdmin(failing);
    const sellerEmail = stuck.invitation.sellerEmail;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    for (let run = 1; run <= RETIRE_FAILURES + 1; run++) {
      await runRetirePages({ now });
    }

    const held = warn.mock.calls
      .map((args) => args.join(" "))
      .filter((line) => line.includes("retire page held"));
    expect(held).toHaveLength(1);
    expect(held[0]).toContain(stuck.id);
    const logged = [...warn.mock.calls, ...error.mock.calls]
      .flat()
      .map(String)
      .join("\n");
    expect(logged).not.toContain(sellerEmail);
  });
});
