import { describe, it, expect, beforeAll } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing, asStaff } from "@/../tests/factories.js";
import { addMonths, addDays, MINUTE_MS } from "@/modules/core/time.js";
import {
  transition,
  LISTING_EVENTS,
  adjustTime,
  MAX_EXTENSION_MINUTES,
  ValidationError,
  ForbiddenActorError,
} from "@/modules/core/index.js";

describe("Time calculations (AC: month math and adjustments)", () => {
  let staffActor;

  beforeAll(async () => {
    await resetDb();
    const staff = asStaff();
    staffActor = { type: "STAFF", ref: staff.session.email };
  });

  describe("AC: addMonths handles month boundaries in shop timezone", () => {
    it("Jan 31 + 1 month = Feb 28 (2027)", () => {
      const jan31 = new Date("2027-01-31T12:00:00Z");
      const result = addMonths(jan31, 1, "America/New_York");
      expect(result.getUTCDate()).toBe(28);
      expect(result.getUTCMonth()).toBe(1); // February
    });

    it("Jan 31 + 1 month = Feb 29 (2028, leap year)", () => {
      const jan31 = new Date("2028-01-31T12:00:00Z");
      const result = addMonths(jan31, 1, "America/New_York");
      expect(result.getUTCDate()).toBe(29);
      expect(result.getUTCMonth()).toBe(1); // February
    });

    it("PAY event sets expiresAt to +1 month from now", async () => {
      const listing = await makeListing({
        status: "APPROVED_AWAITING_PAYMENT",
      });
      const now = new Date("2027-01-31T12:00:00Z");

      const updated = await transition(
        listing.id,
        LISTING_EVENTS.PAY,
        { type: "SYSTEM" },
        { billingMode: "ONE_MONTH" },
        { now },
      );

      const expected = addMonths(now, 1);
      expect(updated.expiresAt.getUTCDate()).toBe(expected.getUTCDate());
      expect(updated.expiresAt.getUTCMonth()).toBe(expected.getUTCMonth());
    });
  });

  describe("AC: Investigation pause and restore", () => {
    it("RESUME with violation: false restores exactly the paused minutes", async () => {
      const now = new Date("2027-01-15T12:00:00Z");
      const expiresAt = addDays(now, 30);
      const listing = await makeListing({ status: "LIVE", expiresAt });

      // Pause the listing
      const paused = await transition(
        listing.id,
        LISTING_EVENTS.PAUSE,
        staffActor,
        { reason: "INVESTIGATION" },
        { now },
      );

      // Wait 5 minutes (purely for this test)
      const resumeNow = new Date(now.getTime() + 5 * 60 * 1000);
      const originalExpires = paused.expiresAt;

      const resumed = await transition(
        listing.id,
        LISTING_EVENTS.RESUME,
        staffActor,
        { violation: false },
        { now: resumeNow },
      );

      // Check that expiresAt was extended by ~5 minutes (rounded down to whole minute)
      const added = resumed.expiresAt.getTime() - originalExpires.getTime();
      const addedMinutes = Math.floor(added / MINUTE_MS);
      expect(addedMinutes).toBe(5);

      // Verify a ListingTimeAdjustment was created
      const adjustment = await prisma.listingTimeAdjustment.findFirst({
        where: { listingId: listing.id, type: "INVESTIGATION_RESTORE" },
      });
      expect(adjustment).toBeDefined();
      expect(adjustment.minutes).toBe(5);
    });

    it("RESUME with violation: true does not restore time", async () => {
      const now = new Date("2027-01-15T12:00:00Z");
      const expiresAt = addDays(now, 30);
      const listing = await makeListing({ status: "LIVE", expiresAt });

      const paused = await transition(
        listing.id,
        LISTING_EVENTS.PAUSE,
        staffActor,
        { reason: "INVESTIGATION" },
        { now },
      );

      const resumeNow = new Date(now.getTime() + 5 * 60 * 1000);
      const originalExpires = paused.expiresAt;

      const resumed = await transition(
        listing.id,
        LISTING_EVENTS.RESUME,
        staffActor,
        { violation: true },
        { now: resumeNow },
      );

      expect(resumed.expiresAt).toEqual(originalExpires);

      // No adjustment should be created
      const adjustment = await prisma.listingTimeAdjustment.findFirst({
        where: { listingId: listing.id, type: "INVESTIGATION_RESTORE" },
      });
      expect(adjustment).toBeNull();
    });
  });

  describe("SEC: adjustTime validation", () => {
    it("SEC: non-staff actor is rejected", async () => {
      const now = new Date();
      const expiresAt = addDays(now, 30);
      const listing = await makeListing({ status: "LIVE", expiresAt });

      await expect(
        adjustTime(
          listing.id,
          { minutes: 60, reason: "test" },
          {
            type: "SELLER",
          },
        ),
      ).rejects.toThrow(ForbiddenActorError);
    });

    it("SEC: missing reason is rejected", async () => {
      const now = new Date();
      const expiresAt = addDays(now, 30);
      const listing = await makeListing({ status: "LIVE", expiresAt });

      await expect(
        adjustTime(listing.id, { minutes: 60 }, staffActor),
      ).rejects.toThrow(ValidationError);
    });

    it("SEC: extension exceeding MAX_EXTENSION_MINUTES is rejected", async () => {
      const now = new Date();
      const expiresAt = addDays(now, 30);
      const listing = await makeListing({ status: "LIVE", expiresAt });

      await expect(
        adjustTime(
          listing.id,
          { minutes: MAX_EXTENSION_MINUTES + 1, reason: "test" },
          staffActor,
        ),
      ).rejects.toThrow(ValidationError);
    });

    it("SEC: zero or negative minutes is rejected", async () => {
      const now = new Date();
      const expiresAt = addDays(now, 30);
      const listing = await makeListing({ status: "LIVE", expiresAt });

      await expect(
        adjustTime(listing.id, { minutes: 0, reason: "test" }, staffActor),
      ).rejects.toThrow(ValidationError);
    });
  });
});
