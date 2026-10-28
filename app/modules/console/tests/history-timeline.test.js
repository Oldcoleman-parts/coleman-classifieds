import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { makeListing } from "@/../tests/factories.js";
import {
  handleReviewAction,
  loadReviewScreen,
} from "@/modules/console/index.js";
import { setUp, tearDown, staffActor, prisma } from "./helpers.js";

describe("F05-T2: History timeline", () => {
  beforeAll(async () => {
    await setUp();
  });

  beforeEach(async () => {
    await setUp();
  });

  afterEach(() => {
    tearDown();
  });

  it("AC: history rows are ordered oldest first", async () => {
    const listing = await makeListing({ status: "LIVE" });

    // Create events at different times
    const baseTime = new Date("2026-10-01T12:00:00Z");
    await prisma.auditEvent.createMany({
      data: [
        {
          listingId: listing.id,
          actor: "STAFF",
          actorRef: "staff@example.test",
          action: "Event1",
          details: {},
          at: new Date(baseTime.getTime()),
        },
        {
          listingId: listing.id,
          actor: "STAFF",
          actorRef: "staff@example.test",
          action: "Event2",
          details: {},
          at: new Date(baseTime.getTime() + 1000),
        },
        {
          listingId: listing.id,
          actor: "STAFF",
          actorRef: "staff@example.test",
          action: "Event3",
          details: {},
          at: new Date(baseTime.getTime() + 2000),
        },
      ],
    });

    const screen = await loadReviewScreen(listing.id);
    const rows = screen.history.rows;

    expect(rows[0].action).toBe("Event1");
    expect(rows[1].action).toBe("Event2");
    expect(rows[2].action).toBe("Event3");
  });

  it("AC: there are no edit or delete controls for history", async () => {
    const listing = await makeListing({ status: "LIVE" });

    await prisma.auditEvent.create({
      data: {
        listingId: listing.id,
        actor: "STAFF",
        actorRef: "staff@example.test",
        action: "ListingSubmitted",
        details: {},
        at: new Date(),
      },
    });

    const before = await prisma.auditEvent.count({
      where: { listingId: listing.id },
    });

    // Try to "edit-history"
    const formEdit = new FormData();
    formEdit.set("intent", "edit-history");
    const resultEdit = await handleReviewAction(listing.id, formEdit, {
      actor: staffActor,
    });

    expect(resultEdit.ok).toBe(false);
    expect(resultEdit.message).toContain("Unknown action");

    // Try to "delete-history"
    const formDelete = new FormData();
    formDelete.set("intent", "delete-history");
    const resultDelete = await handleReviewAction(listing.id, formDelete, {
      actor: staffActor,
    });

    expect(resultDelete.ok).toBe(false);
    expect(resultDelete.message).toContain("Unknown action");

    // Verify no audit rows were added
    const after = await prisma.auditEvent.count({
      where: { listingId: listing.id },
    });
    expect(after).toBe(before);
  });

  it("AC: unknown intents return not ok", async () => {
    const listing = await makeListing({ status: "LIVE" });

    const form = new FormData();
    form.set("intent", "nonexistent-action");
    const result = await handleReviewAction(listing.id, form, {
      actor: staffActor,
    });

    expect(result.ok).toBe(false);
  });
});
