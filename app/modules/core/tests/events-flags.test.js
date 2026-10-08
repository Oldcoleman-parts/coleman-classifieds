import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing, asStaff } from "@/../tests/factories.js";
import {
  publish,
  subscribe,
  resetEventBus,
  EVENTS,
  isEnabled,
  setFlag,
  getSettings,
  ForbiddenActorError,
  ConflictError,
} from "@/modules/core/index.js";

describe("Event bus and flags (AC + SEC: audit and feature gates)", () => {
  let staffActor;

  beforeAll(async () => {
    await resetDb();
    const staff = asStaff();
    staffActor = { type: "STAFF", ref: staff.session.email };
  });

  beforeEach(() => {
    resetEventBus();
  });

  describe("AC: Event bus writes audit before handlers run", () => {
    it("AC: audit row exists before handler is called", async () => {
      const listing = await makeListing();
      let auditIdInHandler;

      const unsubscribe = subscribe(
        EVENTS.ListingApproved,
        (_payload, meta) => {
          auditIdInHandler = meta.auditId;
        },
      );

      await publish(EVENTS.ListingApproved, { listingId: listing.id });

      expect(auditIdInHandler).toBeTruthy();
      const audit = await prisma.auditEvent.findUnique({
        where: { id: auditIdInHandler },
      });
      expect(audit).toBeDefined();
      expect(audit.action).toBe("ListingApproved");

      unsubscribe();
    });

    it("AC: handler that throws does not stop other handlers", async () => {
      const results = [];

      const unsub1 = subscribe(EVENTS.ListingApproved, () => {
        results.push("handler1");
        throw new Error("Handler 1 failed");
      });

      const unsub2 = subscribe(EVENTS.ListingApproved, () => {
        results.push("handler2");
      });

      const listing = await makeListing();
      await publish(EVENTS.ListingApproved, { listingId: listing.id });

      expect(results).toContain("handler1");
      expect(results).toContain("handler2");

      unsub1();
      unsub2();
    });

    it("AC: PaymentReceived with multiple handlers, first throws, both run, publish rejects", async () => {
      const results = [];
      const error1 = new Error("Payment handler 1 failed");

      const unsub1 = subscribe(EVENTS.PaymentReceived, () => {
        results.push("handler1");
        throw error1;
      });

      const unsub2 = subscribe(EVENTS.PaymentReceived, () => {
        results.push("handler2");
      });

      const listing = await makeListing();
      await expect(
        publish(EVENTS.PaymentReceived, {
          listingId: listing.id,
          orderGid: "gid://shopify/Order/1",
          billingMode: "ONE_MONTH",
        }),
      ).rejects.toThrow(error1);

      expect(results).toContain("handler1");
      expect(results).toContain("handler2");

      unsub1();
      unsub2();
    });

    it("AC: publish inside handler is queued and runs after current handlers", async () => {
      const order = [];

      const unsub1 = subscribe(EVENTS.ListingApproved, async () => {
        order.push("handler1_start");
        const listing = await makeListing();
        await publish(EVENTS.ListingRejected, { listingId: listing.id });
        order.push("handler1_end");
      });

      const unsub2 = subscribe(EVENTS.ListingRejected, () => {
        order.push("handler2");
      });

      const listing = await makeListing();
      await publish(EVENTS.ListingApproved, { listingId: listing.id });

      expect(order).toEqual(["handler1_start", "handler1_end", "handler2"]);

      unsub1();
      unsub2();
    });
  });

  describe("AC: Audit details keep only whitelisted fields", () => {
    it("AC: extra fields in payload are not stored in audit", async () => {
      const listing = await makeListing();

      await publish(EVENTS.ListingApproved, {
        listingId: listing.id,
        secretToken: "should-not-be-stored",
        password: "also-not-stored",
      });

      const audit = await prisma.auditEvent.findFirst({
        where: { action: "ListingApproved" },
      });

      expect(audit.details).not.toHaveProperty("secretToken");
      expect(audit.details).not.toHaveProperty("password");
    });
  });

  describe("SEC: Flag changes need admin session", () => {
    afterEach(async () => {
      process.env.RENEWALS_RELEASED = "false";
      await resetDb();
    });

    it("SEC: SELLER cannot setFlag", async () => {
      await expect(setFlag("alerts", true, { type: "SELLER" })).rejects.toThrow(
        ForbiddenActorError,
      );
    });

    it("SEC: SYSTEM cannot setFlag", async () => {
      await expect(setFlag("alerts", true, { type: "SYSTEM" })).rejects.toThrow(
        ForbiddenActorError,
      );
    });

    it("SEC: closed release gate prevents enabling feature", async () => {
      process.env.RENEWALS_RELEASED = "false";

      await expect(setFlag("renewals", true, staffActor)).rejects.toThrow(
        ConflictError,
      );
    });

    it("SEC: staff can enable released features", async () => {
      process.env.RENEWALS_RELEASED = "true";

      await setFlag("renewals", true, staffActor);

      const settings = await getSettings();
      expect(settings.renewalsEnabled).toBe(true);
      expect(await isEnabled("renewals")).toBe(true);
      expect(
        await prisma.auditEvent.count({ where: { action: "FeatureToggled" } }),
      ).toBe(1);

      // Switched on in Settings, but the release gate closes again: the flag reads as off.
      process.env.RENEWALS_RELEASED = "false";
      expect(await isEnabled("renewals")).toBe(false);
    });

    it("AC: getSettings() twice returns the same row", async () => {
      const settings1 = await getSettings();
      const settings2 = await getSettings();

      expect(settings1.id).toBe(settings2.id);
      expect(settings1.id).toBe(1);
      expect(await prisma.settings.count()).toBe(1);
    });
  });
});
