import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { makeListing } from "@/../tests/factories.js";
import { loadListingList } from "@/modules/console/index.js";
import { setUp, tearDown, prisma } from "./helpers.js";

describe("F05-T1: Listing list", () => {
  beforeAll(async () => {
    await setUp();
  });

  beforeEach(async () => {
    await setUp();
  });

  afterEach(tearDown);

  it("AC: Counts match DB; search narrows rows", async () => {
    const email = "seller@test.local";
    const other = "other@test.local";

    // Create listings across statuses
    const submitted = await makeListing({
      status: "SUBMITTED",
      title: "Coleman 200A lantern",
      invitation: { sellerEmail: email, sellerName: "Pat Smith" },
    });
    const live = await makeListing({
      status: "LIVE",
      title: "Stove for sale",
      invitation: { sellerEmail: email, sellerName: "Pat Smith" },
    });
    const liveWithPending = await makeListing({
      status: "LIVE",
      invitation: { sellerEmail: email },
    });
    const draft = await makeListing({
      status: "DRAFT",
      invitation: { sellerEmail: other },
    });
    const changesRequested = await makeListing({
      status: "CHANGES_REQUESTED",
      invitation: { sellerEmail: email },
    });
    const paused = await makeListing({
      status: "PAUSED",
      invitation: { sellerEmail: email },
    });
    const rejected = await makeListing({
      status: "REJECTED",
      invitation: { sellerEmail: email },
    });
    await makeListing({
      status: "INVITED",
      invitation: { sellerEmail: email },
    });
    const approved = await makeListing({
      status: "APPROVED_AWAITING_PAYMENT",
      invitation: { sellerEmail: email },
    });

    // Add a pending revision to one LIVE listing
    await prisma.listingRevision.create({
      data: { listingId: liveWithPending.id, status: "PENDING", changes: {} },
    });

    // Load all tabs
    const allTab = await loadListingList({ tab: "all" });

    // All tab excludes INVITED
    expect(allTab.tab).toBe("all");
    const expectedAll = [
      submitted,
      live,
      liveWithPending,
      draft,
      changesRequested,
      paused,
      rejected,
      approved,
    ];
    expect(allTab.rows).toHaveLength(8);
    expect(allTab.rows.map((r) => r.id).sort()).toEqual(
      expectedAll.map((l) => l.id).sort(),
    );

    // Counts
    const reviewTab = await loadListingList({ tab: "review" });
    expect(reviewTab.tabs.find((t) => t.key === "all").count).toBe(8);
    expect(reviewTab.tabs.find((t) => t.key === "review").count).toBe(2); // SUBMITTED + LIVE with PENDING
    expect(reviewTab.tabs.find((t) => t.key === "drafts").count).toBe(2); // DRAFT + CHANGES_REQUESTED
    expect(reviewTab.tabs.find((t) => t.key === "payment").count).toBe(1);
    expect(reviewTab.tabs.find((t) => t.key === "live").count).toBe(2); // Both LIVE, one with revision
    expect(reviewTab.tabs.find((t) => t.key === "paused").count).toBe(1);
    expect(reviewTab.tabs.find((t) => t.key === "closed").count).toBe(1); // REJECTED

    // Search by email narrows rows
    const byEmail = await loadListingList({ tab: "all", q: "seller@test" });
    expect(byEmail.q).toBe("seller@test");
    expect(byEmail.rows).toHaveLength(7); // All of pat smith's except invited
    expect(byEmail.rows.map((r) => r.id)).toEqual(
      expect.arrayContaining([submitted.id, live.id, liveWithPending.id]),
    );

    // Search by title narrows rows
    const byTitle = await loadListingList({ tab: "all", q: "Coleman" });
    expect(byTitle.q).toBe("Coleman");
    expect(byTitle.rows).toHaveLength(1);
    expect(byTitle.rows[0].id).toBe(submitted.id);

    // Search by name narrows rows
    const byName = await loadListingList({ tab: "all", q: "Pat" });
    expect(byName.rows).toHaveLength(2);
    expect(byName.rows.map((r) => r.id).sort()).toEqual(
      [submitted.id, live.id].sort(),
    );
  });

  it("AC: Pagination with >50 rows", async () => {
    // Create 52 listings
    const ids = [];
    for (let i = 0; i < 52; i++) {
      const listing = await makeListing({
        status: "LIVE",
        title: `Listing ${String(i).padStart(2, "0")}`,
      });
      ids.push(listing.id);
    }

    // First page
    const page1 = await loadListingList({ tab: "live" });
    expect(page1.rows).toHaveLength(50);
    expect(page1.nextCursor).toBe(page1.rows[49].id);

    // Second page
    const page2 = await loadListingList({
      tab: "live",
      cursor: page1.nextCursor,
    });
    expect(page2.rows).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();

    // Both pages unique
    const page1Ids = new Set(page1.rows.map((r) => r.id));
    const page2Ids = new Set(page2.rows.map((r) => r.id));
    expect(page1Ids.size + page2Ids.size).toBe(52);
  });

  it("AC: Row includes changePending when LIVE with PENDING revision", async () => {
    const listing = await makeListing({ status: "LIVE" });
    await prisma.listingRevision.create({
      data: { listingId: listing.id, status: "PENDING", changes: {} },
    });

    const result = await loadListingList({ tab: "live" });
    expect(result.rows[0]).toMatchObject({
      id: listing.id,
      changePending: true,
    });
  });

  it("AC: Row omits changePending when no PENDING revision", async () => {
    const listing = await makeListing({ status: "SUBMITTED" });

    const result = await loadListingList({ tab: "all" });
    expect(result.rows[0]).toMatchObject({
      id: listing.id,
      changePending: false,
    });
  });
});
