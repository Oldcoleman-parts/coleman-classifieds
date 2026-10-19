import { describe, it, expect, beforeEach } from "vitest";
import { EVENTS, publish } from "@/modules/core/index.js";
import { registerListeners } from "@/modules/payments/events.js";
import { handleRefundCreated } from "@/modules/payments/services/refunds.js";
import {
  runFollowUps,
  runLapse,
  runReminders,
} from "@/modules/payments/services/tasks.js";
import {
  awaiting,
  breakSes,
  DAY,
  DISCOUNT,
  fakeAdmin,
  freshWorld,
  HOUR,
  prisma,
  problemKeys,
  seedFeeSetup,
} from "./helpers.js";

const ORDER = "gid://shopify/Order/5001";

describe("Refunds and payment tasks (F06-T1)", () => {
  let ses;
  let shopify;
  beforeEach(async () => {
    ({ ses } = await freshWorld());
    await seedFeeSetup();
    shopify = fakeAdmin();
  });

  it("a refund marks the charge and raises one incident; a repeat does nothing", async () => {
    const listing = await awaiting({ status: "LIVE", liveAt: new Date() });
    const charge = await prisma.feeCharge.create({
      data: {
        listingId: listing.id,
        kind: "INITIAL",
        orderGid: ORDER,
        amountCents: 2500,
        status: "PAID",
      },
    });
    const refund = { payload: { id: 9001, order_id: 5001 } };
    await handleRefundCreated(refund);
    await handleRefundCreated(refund);
    await handleRefundCreated({ payload: { id: 9002, order_id: 77 } });
    await handleRefundCreated({ payload: {} });

    const after = await prisma.feeCharge.findUnique({
      where: { id: charge.id },
    });
    expect(after.status).toBe("REFUNDED");
    expect(
      await prisma.auditEvent.count({ where: { action: "FeeRefunded" } }),
    ).toBe(1);
    expect(await problemKeys()).toEqual([`fee-refund:${ORDER}`]);
    // The listing is left to staff.
    const same = await prisma.listing.findUnique({ where: { id: listing.id } });
    expect(same.status).toBe("LIVE");
    expect(same.refundFlag).toBe(false);
  });

  it("the reminder is sent once, 2 days before the deadline", async () => {
    const now = new Date();
    const soon = await awaiting({
      paymentDueBy: new Date(now.getTime() + DAY),
    });
    await awaiting({ paymentDueBy: new Date(now.getTime() + 5 * DAY) });
    await awaiting({ paymentDueBy: new Date(now.getTime() - HOUR) });

    expect(await runReminders({ now })).toEqual({ due: 1, failed: 0 });
    await runReminders({ now: new Date(now.getTime() + HOUR) });
    expect(ses.sent).toHaveLength(1);
    expect(ses.sent[0].input.Destination.ToAddresses).toEqual([
      soon.invitation.sellerEmail,
    ]);
    const [row] = await prisma.emailOutbox.findMany();
    expect(row.templateKey).toBe("payment_reminder");
  });

  it("lapse closes unpaid listings after the deadline; two runs, one effect", async () => {
    const now = new Date();
    const late = await awaiting({
      paymentDueBy: new Date(now.getTime() - HOUR),
    });
    const inTime = await awaiting();
    expect(await runLapse({ now })).toMatchObject({ lapsed: 1, errors: 0 });
    expect(await runLapse({ now })).toMatchObject({ lapsed: 0, errors: 0 });
    const status = async ({ id }) =>
      (await prisma.listing.findUnique({ where: { id } })).status;
    expect(await status(late)).toBe("LAPSED");
    expect(await status(inTime)).toBe("APPROVED_AWAITING_PAYMENT");
  });

  it("a closed listing's discount code is deleted, by the listener or the task", async () => {
    registerListeners();
    const closed = await awaiting({
      status: "LAPSED",
      discountCodeId: DISCOUNT,
    });
    await publish(EVENTS.ListingClosed, {
      listingId: closed.id,
      reason: "LAPSED",
    });
    expect(shopify.of("FeeDiscountDelete")).toEqual([{ id: DISCOUNT }]);

    // A used code (the listing went live), and a code Shopify no longer has.
    const live = await awaiting({
      status: "LIVE",
      discountCodeId: "gid://x/2",
    });
    shopify = fakeAdmin({
      FeeDiscountDelete: {
        discountCodeDelete: {
          deletedCodeDiscountId: null,
          userErrors: [{ code: "NOT_FOUND", message: "gone" }],
        },
      },
    });
    expect(await runLapse()).toMatchObject({ codesDeleted: 1, errors: 0 });
    expect(await runLapse()).toMatchObject({ codesDeleted: 0 });
    for (const { id } of [closed, live])
      expect(
        (await prisma.listing.findUnique({ where: { id } })).discountCodeId,
      ).toBeNull();
    // A listing still awaiting payment keeps its code.
    const open = await awaiting({ discountCodeId: "gid://x/3" });
    await runLapse();
    expect(
      (await prisma.listing.findUnique({ where: { id: open.id } }))
        .discountCodeId,
    ).toBe("gid://x/3");
  });

  it("the follow-up retries a failed approved_pay an hour later, three times at most", async () => {
    // Approved just now: the payment window is 7 days.
    const now = new Date();
    await awaiting({ paymentDueBy: new Date(now.getTime() + 7 * DAY) });
    breakSes(ses);
    expect(await runFollowUps({ now })).toMatchObject({ emailFailed: 1 });
    // Within the hour nothing new is tried.
    const tries = ses.send.mock.calls.length;
    await runFollowUps({ now: new Date(now.getTime() + 10 * 60 * 1000) });
    expect(ses.send.mock.calls.length).toBe(tries);

    ses.send.mockReset();
    ses.send.mockResolvedValue({ MessageId: "ok" });
    const later = new Date(now.getTime() + HOUR + 1000);
    expect(await runFollowUps({ now: later })).toMatchObject({
      emailFailed: 0,
    });
    expect(ses.send).toHaveBeenCalledTimes(1);
    await runFollowUps({ now: new Date(later.getTime() + HOUR) });
    expect(ses.send).toHaveBeenCalledTimes(1);
    // The code was created once, on the first run.
    expect(shopify.of("FeeDiscountCreate")).toHaveLength(1);
  });

  it("after three failed tries the follow-up stops", async () => {
    const now = new Date();
    await awaiting({ paymentDueBy: new Date(now.getTime() + 7 * DAY) });
    breakSes(ses);
    for (const hours of [0, 1, 2, 3, 4])
      await runFollowUps({
        now: new Date(now.getTime() + hours * HOUR + 1000),
      });
    expect(await prisma.emailOutbox.count()).toBe(3);
  });
});
