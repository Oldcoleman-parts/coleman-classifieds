import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing } from "@/../tests/factories.js";
import {
  closeUnusedListing,
  ForbiddenActorError,
  getSettings,
  InvalidTransitionError,
  LISTING_EVENTS,
  transition,
  UNUSED_CLOSE_REASONS,
  ValidationError,
} from "@/modules/core/index.js";
import { addDays } from "@/modules/core/time.js";

const NOW = new Date("2027-03-10T15:00:00Z");
const STAFF = { type: "STAFF", ref: "staff@example.test" };
const SYSTEM = { type: "SYSTEM" };
const SELLER = { type: "SELLER" };

const auditFor = (listingId) =>
  prisma.auditEvent.findMany({ where: { listingId }, orderBy: { at: "asc" } });

describe("closeUnusedListing (AC: unused invitation closed with reason, purgeAfter and one audit entry)", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  const reasonCases = [
    {
      reason: "INVITATION_EXPIRED",
      action: "InvitationExpired",
      actor: SYSTEM,
      actorRef: null,
    },
    {
      reason: "INVITATION_REVOKED",
      action: "InvitationRevoked",
      actor: STAFF,
      actorRef: STAFF.ref,
    },
  ];

  it.each(reasonCases)(
    "AC: $reason sets closedAt, closedReason and purgeAfter, keeps INVITED, writes one $action audit row",
    async ({ reason, action, actor, actorRef }) => {
      const settings = await getSettings();
      const listing = await makeListing({ status: "INVITED" });

      const result = await closeUnusedListing(listing.id, reason, actor, {
        now: NOW,
      });

      expect(result.closed).toBe(true);
      const row = await prisma.listing.findUnique({
        where: { id: listing.id },
      });
      expect(row.status).toBe("INVITED");
      expect(row.closedAt).toEqual(NOW);
      expect(row.closedReason).toBe(reason);
      expect(row.purgeAfter).toEqual(
        addDays(NOW, settings.recordsRetentionDays),
      );

      const audit = await auditFor(listing.id);
      expect(audit).toHaveLength(1);
      expect(audit[0].action).toBe(action);
      expect(audit[0].actorRef).toBe(actorRef);
      expect(audit[0].details).toMatchObject({
        invitationId: listing.invitationId,
        closedReason: reason,
        status: "INVITED",
      });
    },
  );

  it("AC: the reason map pairs each reason with exactly one actor type", () => {
    expect(UNUSED_CLOSE_REASONS).toEqual({
      INVITATION_EXPIRED: "SYSTEM",
      INVITATION_REVOKED: "STAFF",
    });
  });

  it.each(["DRAFT", "SUBMITTED", "LIVE"])(
    "AC: a listing that is %s is refused and nothing is written",
    async (status) => {
      const listing = await makeListing({ status });
      const before = await prisma.listing.findUnique({
        where: { id: listing.id },
      });

      await expect(
        closeUnusedListing(listing.id, "INVITATION_REVOKED", STAFF, {
          now: NOW,
        }),
      ).rejects.toThrow(InvalidTransitionError);

      const after = await prisma.listing.findUnique({
        where: { id: listing.id },
      });
      expect(after).toEqual(before);
      expect(await auditFor(listing.id)).toHaveLength(0);
    },
  );

  it("AC: a repeat call changes nothing and writes no second audit entry", async () => {
    const listing = await makeListing({ status: "INVITED" });
    const first = await closeUnusedListing(
      listing.id,
      "INVITATION_EXPIRED",
      SYSTEM,
      { now: NOW },
    );
    const second = await closeUnusedListing(
      listing.id,
      "INVITATION_EXPIRED",
      SYSTEM,
      { now: addDays(NOW, 1) },
    );

    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);
    const row = await prisma.listing.findUnique({ where: { id: listing.id } });
    expect(row.closedAt).toEqual(NOW);
    expect(await auditFor(listing.id)).toHaveLength(1);
  });

  it.each([
    {
      name: "STAFF cannot close as INVITATION_EXPIRED",
      reason: "INVITATION_EXPIRED",
      actor: STAFF,
      error: ForbiddenActorError,
    },
    {
      name: "SYSTEM cannot close as INVITATION_REVOKED",
      reason: "INVITATION_REVOKED",
      actor: SYSTEM,
      error: ForbiddenActorError,
    },
    {
      name: "SELLER cannot close as INVITATION_REVOKED",
      reason: "INVITATION_REVOKED",
      actor: SELLER,
      error: ForbiddenActorError,
    },
    {
      name: "an unknown reason is a validation error",
      reason: "LAPSED_BY_HAND",
      actor: STAFF,
      error: ValidationError,
    },
  ])("SEC: $name", async ({ reason, actor, error }) => {
    const listing = await makeListing({ status: "INVITED" });

    await expect(
      closeUnusedListing(listing.id, reason, actor, { now: NOW }),
    ).rejects.toThrow(error);

    const row = await prisma.listing.findUnique({ where: { id: listing.id } });
    expect(row.closedAt).toBeNull();
    expect(row.closedReason).toBeNull();
    expect(row.purgeAfter).toBeNull();
    expect(await auditFor(listing.id)).toHaveLength(0);
  });

  it("SEC: transition() refuses OPEN on a closed INVITED listing", async () => {
    const listing = await makeListing({ status: "INVITED" });
    await closeUnusedListing(listing.id, "INVITATION_REVOKED", STAFF, {
      now: NOW,
    });

    await expect(
      transition(listing.id, LISTING_EVENTS.OPEN, SELLER, {}, { now: NOW }),
    ).rejects.toThrow(InvalidTransitionError);

    const row = await prisma.listing.findUnique({ where: { id: listing.id } });
    expect(row.status).toBe("INVITED");
    expect(row.draftStartedAt).toBeNull();
    expect(await auditFor(listing.id)).toHaveLength(1);
  });

  it("AC: when the caller's transaction rolls back, the close rolls back with it", async () => {
    const listing = await makeListing({ status: "INVITED" });

    await expect(
      prisma.$transaction(async (tx) => {
        await closeUnusedListing(listing.id, "INVITATION_REVOKED", STAFF, {
          tx,
          now: NOW,
        });
        throw new Error("rollback on purpose");
      }),
    ).rejects.toThrow("rollback on purpose");

    const row = await prisma.listing.findUnique({ where: { id: listing.id } });
    expect(row.closedAt).toBeNull();
    expect(row.closedReason).toBeNull();
    expect(row.purgeAfter).toBeNull();
    expect(await auditFor(listing.id)).toHaveLength(0);
  });
});
