import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { makeListing } from "@/../tests/factories.js";
import {
  handleMessageAction,
  loadMessagesScreen,
  setMessageProvider,
} from "@/modules/console/index.js";
import { setUp, tearDown, staffActor, STAFF, prisma } from "./helpers.js";

describe("F05-T2: Held messages", () => {
  beforeAll(async () => {
    await setUp();
  });

  beforeEach(async () => {
    await setUp();
  });

  afterEach(() => {
    setMessageProvider(null);
    tearDown();
  });

  it("AC: no provider returns empty state and 404 result", async () => {
    setMessageProvider(null);

    const screen = await loadMessagesScreen();
    expect(screen.available).toBe(false);
    expect(screen.rows).toEqual([]);

    const form = new FormData();
    form.set("intent", "release");
    form.set("messageId", "msg-123");
    const result = await handleMessageAction(form, staffActor);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it("AC: unknown intent returns not ok", async () => {
    setMessageProvider({
      listHeld: async () => [],
      release: async () => ({ changed: false }),
      discard: async () => ({ changed: false }),
    });

    const form = new FormData();
    form.set("intent", "unknown-action");
    form.set("messageId", "msg-123");
    const result = await handleMessageAction(form, staffActor);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it("SEC: double release sends once", async () => {
    const listing = await makeListing();
    let releaseCount = 0;

    setMessageProvider({
      listHeld: async () => [
        {
          id: "msg-1",
          listingId: listing.id,
          listingTitle: "Test Item",
          buyerName: "Buyer",
          buyerEmail: "buyer@example.test",
          body: "Hi, interested",
          holdReasons: [],
          createdAt: new Date(),
        },
      ],
      release: async () => {
        releaseCount++;
        return { changed: releaseCount === 1, listingId: listing.id };
      },
      discard: async () => ({ changed: false }),
    });

    // First release
    const form1 = new FormData();
    form1.set("intent", "release");
    form1.set("messageId", "msg-1");
    const result1 = await handleMessageAction(form1, staffActor);

    expect(result1.ok).toBe(true);
    expect(result1.already).toBe(false);
    expect(releaseCount).toBe(1);

    // Verify audit was written
    let audits = await prisma.auditEvent.findMany({
      where: { action: "HeldMessageReleased", listingId: listing.id },
    });
    expect(audits).toHaveLength(1);

    // Second release
    const form2 = new FormData();
    form2.set("intent", "release");
    form2.set("messageId", "msg-1");
    const result2 = await handleMessageAction(form2, staffActor);

    expect(result2.ok).toBe(true);
    expect(result2.already).toBe(true);
    expect(releaseCount).toBe(2);

    // Verify no second audit was written
    audits = await prisma.auditEvent.findMany({
      where: { action: "HeldMessageReleased", listingId: listing.id },
    });
    expect(audits).toHaveLength(1);
  });

  it("AC: discard is audited with staff email and never calls release", async () => {
    const listing = await makeListing();
    let releaseCalled = false;

    setMessageProvider({
      listHeld: async () => [],
      release: async () => {
        releaseCalled = true;
        return { changed: false };
      },
      discard: async () => {
        return { changed: true, listingId: listing.id };
      },
    });

    const form = new FormData();
    form.set("intent", "discard");
    form.set("messageId", "msg-1");
    const result = await handleMessageAction(form, staffActor);

    expect(result.ok).toBe(true);
    expect(releaseCalled).toBe(false);

    const audits = await prisma.auditEvent.findMany({
      where: { action: "HeldMessageDiscarded", listingId: listing.id },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toBe("STAFF");
    expect(audits[0].actorRef).toBe(STAFF.session.email);

    // Verify audit details contain no body or buyer email
    expect(JSON.stringify(audits[0].details)).not.toContain("body");
    expect(JSON.stringify(audits[0].details)).not.toContain("buyer");
  });

  it("AC: discard audit details contain only messageId", async () => {
    const listing = await makeListing();

    setMessageProvider({
      listHeld: async () => [],
      release: async () => ({ changed: false }),
      discard: async () => ({ changed: true, listingId: listing.id }),
    });

    const form = new FormData();
    form.set("intent", "discard");
    form.set("messageId", "msg-abc-123");
    await handleMessageAction(form, staffActor);

    const audits = await prisma.auditEvent.findMany({
      where: { action: "HeldMessageDiscarded" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].details.messageId).toBe("msg-abc-123");
    expect(Object.keys(audits[0].details)).toEqual(["messageId"]);
  });
});
