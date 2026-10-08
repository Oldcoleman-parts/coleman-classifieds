import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing } from "@/../tests/factories.js";
import {
  publish,
  resetEventBus,
  EVENTS,
  register,
} from "@/modules/core/index.js";
import * as eventsModule from "@/modules/core/events.js";

const payment = (listing) => ({
  listingId: listing.id,
  orderGid: "gid://shopify/Order/1",
  billingMode: "ONE_MONTH",
});

describe("PaymentReceived handler (F01-FIX-1)", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(() => {
    resetEventBus();
    register();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("AC1 + SEC: a temporary failure rejects the publish, rolls back and logs no message", async () => {
    const listing = await makeListing({
      status: "APPROVED_AWAITING_PAYMENT",
      liveAt: null,
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const dbError = Object.assign(new Error("Database connection lost"), {
      code: "P1001",
    });

    // `transition()` has updated the listing when it records its event, in the same
    // transaction: failing there is a real rollback.
    vi.spyOn(eventsModule, "recordEvent").mockImplementationOnce(async () => {
      throw dbError;
    });

    await expect(
      publish(EVENTS.PaymentReceived, payment(listing)),
    ).rejects.toBe(dbError);

    const reloaded = await prisma.listing.findUnique({
      where: { id: listing.id },
    });
    expect(reloaded.status).toBe("APPROVED_AWAITING_PAYMENT");
    expect(reloaded.liveAt).toBeNull();
    expect(reloaded.expiresAt).toBeNull();
    expect(reloaded.billingMode).toBe(listing.billingMode);
    expect(reloaded.refundFlag).toBe(false);
    expect(
      await prisma.auditEvent.count({
        where: {
          listingId: listing.id,
          action: { in: ["ListingWentLive", "PaymentNotApplied"] },
        },
      }),
    ).toBe(0);

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toMatch(
      /^\[events\] a PaymentReceived handler failed \(audit [a-z0-9]+\): Error P1001$/,
    );

    // The retried delivery applies the payment.
    await publish(EVENTS.PaymentReceived, payment(listing));
    const final = await prisma.listing.findUnique({
      where: { id: listing.id },
    });
    expect(final.status).toBe("LIVE");
    expect(final.liveAt).toBeInstanceOf(Date);
    expect(final.expiresAt.getTime()).toBeGreaterThan(final.liveAt.getTime());
    expect(final.refundFlag).toBe(false);
  });

  it.each([
    { status: "LAPSED", liveAt: null },
    { status: "REJECTED", liveAt: null },
    { status: "EXPIRED", liveAt: null },
    { status: "SUBMITTED", liveAt: null },
  ])(
    "AC2: not applicable status $status resolves and records refund",
    async ({ status, liveAt }) => {
      const listing = await makeListing({
        status,
        liveAt,
        closedReason: status === "REJECTED" ? "REJECTED" : undefined,
      });

      await publish(EVENTS.PaymentReceived, {
        listingId: listing.id,
        orderGid: "gid://shopify/Order/1",
        billingMode: "ONE_MONTH",
      });

      const reloaded = await prisma.listing.findUnique({
        where: { id: listing.id },
        select: { status: true, refundFlag: true },
      });
      expect(reloaded.status).toBe(status);
      expect(reloaded.refundFlag).toBe(true);

      const notApplied = await prisma.auditEvent.findFirst({
        where: { listingId: listing.id, action: "PaymentNotApplied" },
      });
      expect(notApplied).not.toBeNull();
      expect(notApplied.details).toEqual({
        orderGid: "gid://shopify/Order/1",
        status,
        reason: "NOT_PAYABLE",
      });
      expect(notApplied.actor).toBe("SYSTEM");

      // Second publish still resolves
      await publish(EVENTS.PaymentReceived, {
        listingId: listing.id,
        orderGid: "gid://shopify/Order/1",
        billingMode: "ONE_MONTH",
      });

      const count = await prisma.auditEvent.count({
        where: { listingId: listing.id, action: "PaymentNotApplied" },
      });
      expect(count).toBe(1);
    },
  );

  it("AC2: invalid billingMode on APPROVED_AWAITING_PAYMENT", async () => {
    const listing = await makeListing({
      status: "APPROVED_AWAITING_PAYMENT",
    });

    await publish(EVENTS.PaymentReceived, {
      listingId: listing.id,
      orderGid: "gid://shopify/Order/1",
      billingMode: "INVALID_MODE",
    });

    const reloaded = await prisma.listing.findUnique({
      where: { id: listing.id },
      select: { status: true, refundFlag: true },
    });
    expect(reloaded.status).toBe("APPROVED_AWAITING_PAYMENT");
    expect(reloaded.refundFlag).toBe(true);

    const notApplied = await prisma.auditEvent.findFirst({
      where: { listingId: listing.id, action: "PaymentNotApplied" },
    });
    expect(notApplied).not.toBeNull();
    expect(notApplied.details).toEqual({
      orderGid: "gid://shopify/Order/1",
      status: "APPROVED_AWAITING_PAYMENT",
      reason: "INVALID_EVENT",
    });
  });

  it("AC3: repeated payment for APPROVED_AWAITING_PAYMENT listing", async () => {
    const listing = await makeListing({
      status: "APPROVED_AWAITING_PAYMENT",
      liveAt: null,
    });

    await publish(EVENTS.PaymentReceived, {
      listingId: listing.id,
      orderGid: "gid://shopify/Order/1",
      billingMode: "ONE_MONTH",
    });

    const live1 = await prisma.listing.findUnique({
      where: { id: listing.id },
      select: { status: true, liveAt: true, expiresAt: true },
    });
    expect(live1.status).toBe("LIVE");
    expect(live1.liveAt).not.toBeNull();
    expect(live1.expiresAt).not.toBeNull();

    const wentLive1 = await prisma.auditEvent.count({
      where: { listingId: listing.id, action: "ListingWentLive" },
    });
    expect(wentLive1).toBe(1);

    // Second publish
    await publish(EVENTS.PaymentReceived, {
      listingId: listing.id,
      orderGid: "gid://shopify/Order/1",
      billingMode: "ONE_MONTH",
    });

    const live2 = await prisma.listing.findUnique({
      where: { id: listing.id },
      select: { status: true, liveAt: true, expiresAt: true, refundFlag: true },
    });
    expect(live2.status).toBe("LIVE");
    expect(live2.liveAt).toEqual(live1.liveAt);
    expect(live2.expiresAt).toEqual(live1.expiresAt);
    expect(live2.refundFlag).toBe(false);

    const wentLive2 = await prisma.auditEvent.count({
      where: { listingId: listing.id, action: "ListingWentLive" },
    });
    expect(wentLive2).toBe(1);

    const notApplied = await prisma.auditEvent.findFirst({
      where: { listingId: listing.id, action: "PaymentNotApplied" },
    });
    expect(notApplied).toBeNull();
  });

  it("AC3: payment for SOLD listing with liveAt set is harmless", async () => {
    const listing = await makeListing({
      status: "SOLD",
      liveAt: new Date("2027-03-09T00:00:00Z"),
      expiresAt: new Date("2027-04-10T00:00:00Z"),
      closedReason: "SOLD",
    });

    await publish(EVENTS.PaymentReceived, {
      listingId: listing.id,
      orderGid: "gid://shopify/Order/1",
      billingMode: "ONE_MONTH",
    });

    const reloaded = await prisma.listing.findUnique({
      where: { id: listing.id },
      select: { status: true, refundFlag: true },
    });
    expect(reloaded.status).toBe("SOLD");
    expect(reloaded.refundFlag).toBe(false);

    const notApplied = await prisma.auditEvent.findFirst({
      where: { listingId: listing.id, action: "PaymentNotApplied" },
    });
    expect(notApplied).toBeNull();
  });

  it("SEC: ListingWentLive audit has transition details", async () => {
    const listing = await makeListing({
      status: "APPROVED_AWAITING_PAYMENT",
      liveAt: null,
    });

    await publish(EVENTS.PaymentReceived, {
      listingId: listing.id,
      orderGid: "gid://shopify/Order/1",
      billingMode: "ONE_MONTH",
    });

    const wentLive = await prisma.auditEvent.findFirst({
      where: { listingId: listing.id, action: "ListingWentLive" },
    });
    expect(wentLive).not.toBeNull();
    expect(wentLive.details.transition).toBe("PAY");
    expect(wentLive.details.from).toBe("APPROVED_AWAITING_PAYMENT");
    expect(wentLive.details.to).toBe("LIVE");
  });
});
