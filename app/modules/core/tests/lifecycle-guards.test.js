import { describe, it, expect, beforeAll } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing, asStaff } from "@/../tests/factories.js";
import {
  transition,
  LISTING_EVENTS,
  InvalidTransitionError,
  ForbiddenActorError,
} from "@/modules/core/index.js";
import { addDays } from "@/modules/core/time.js";

describe("Lifecycle guards (AC + SEC: invalid transitions and actors rejected)", () => {
  let staff;
  let staffActor;

  beforeAll(async () => {
    await resetDb();
    staff = asStaff();
    staffActor = { type: "STAFF", ref: staff.session.email };
  });

  const guardCases = [
    {
      name: "SELLER cannot APPROVE",
      from: "SUBMITTED",
      event: LISTING_EVENTS.APPROVE,
      actor: { type: "SELLER" },
      error: ForbiddenActorError,
    },
    {
      name: "STAFF cannot SUBMIT as seller",
      from: "DRAFT",
      event: LISTING_EVENTS.SUBMIT,
      useStaff: true,
      error: ForbiddenActorError,
    },
    {
      name: "STAFF cannot OPEN (seller only)",
      from: "INVITED",
      event: LISTING_EVENTS.OPEN,
      useStaff: true,
      error: ForbiddenActorError,
    },
    {
      name: "SELLER cannot EXPIRE (system only)",
      from: "DRAFT",
      event: LISTING_EVENTS.EXPIRE,
      actor: { type: "SELLER" },
      error: ForbiddenActorError,
    },
    {
      name: "STAFF cannot EXPIRE (system only)",
      from: "DRAFT",
      event: LISTING_EVENTS.EXPIRE,
      useStaff: true,
      error: ForbiddenActorError,
    },
    {
      name: "STAFF without ref is rejected",
      from: "SUBMITTED",
      event: LISTING_EVENTS.APPROVE,
      actor: { type: "STAFF" },
      error: ForbiddenActorError,
    },
    {
      name: "SELLER cannot PAUSE",
      from: "LIVE",
      event: LISTING_EVENTS.PAUSE,
      actor: { type: "SELLER" },
      error: ForbiddenActorError,
    },
    {
      name: "Cannot EXPIRE before deadline",
      from: "DRAFT",
      event: LISTING_EVENTS.EXPIRE,
      actor: { type: "SYSTEM" },
      error: InvalidTransitionError,
      dueBy: "future",
    },
    {
      name: "Cannot REQUEST_CHANGES when not SUBMITTED",
      from: "DRAFT",
      event: LISTING_EVENTS.REQUEST_CHANGES,
      useStaff: true,
      payload: { note: "test" },
      error: InvalidTransitionError,
    },
    {
      name: "Cannot APPROVE when not SUBMITTED",
      from: "DRAFT",
      event: LISTING_EVENTS.APPROVE,
      useStaff: true,
      error: InvalidTransitionError,
    },
    {
      name: "Cannot PAY when not APPROVED_AWAITING_PAYMENT",
      from: "DRAFT",
      event: LISTING_EVENTS.PAY,
      actor: { type: "SYSTEM" },
      payload: { billingMode: "ONE_MONTH" },
      error: InvalidTransitionError,
    },
  ];

  it.each(guardCases)("SEC: $name", async (testCase) => {
    const listing = await makeListing({ status: testCase.from });
    const now = new Date();

    if (testCase.dueBy === "future") {
      await prisma.listing.update({
        where: { id: listing.id },
        data: { draftDueBy: addDays(now, 1) },
      });
    }

    const actor = testCase.useStaff ? staffActor : testCase.actor;

    await expect(
      transition(listing.id, testCase.event, actor, testCase.payload || {}, {
        now,
      }),
    ).rejects.toThrow(testCase.error);
  });

  describe("SEC: APPROVE_REVISION leaves expiresAt unchanged and rejects terminal states", () => {
    it("APPROVE_REVISION on LIVE keeps expiresAt the same", async () => {
      const listing = await makeListing({ status: "LIVE" });
      const now = new Date();
      const originalExpires = listing.expiresAt;

      const updated = await transition(
        listing.id,
        LISTING_EVENTS.APPROVE_REVISION,
        staffActor,
        { revisionId: "rev_123", photoIds: [] },
        { now },
      );

      expect(updated.expiresAt).toEqual(originalExpires);
    });

    it.each(["SOLD", "EXPIRED", "REMOVED", "REJECTED", "LAPSED"])(
      "APPROVE_REVISION is rejected for terminal status %s",
      async (terminal) => {
        const listing = await makeListing({ status: terminal });

        await expect(
          transition(listing.id, LISTING_EVENTS.APPROVE_REVISION, staffActor, {
            revisionId: "rev_123",
            photoIds: [],
          }),
        ).rejects.toThrow(InvalidTransitionError);

        // Verify listing is still closed
        const after = await prisma.listing.findUniqueOrThrow({
          where: { id: listing.id },
        });
        expect(after.status).toBe(terminal);
      },
    );
  });
});
