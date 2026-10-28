import { describe, it, expect, beforeEach } from "vitest";
import { EVENTS, subscribe } from "@/modules/core/index.js";
import { discountCodeFor } from "@/modules/payments/services/discount.js";
import { handleOrderPaid } from "@/modules/payments/services/orders-paid.js";
import {
  awaiting,
  fakeAdmin,
  freshWorld,
  prisma,
  problemKeys,
  seedFeeSetup,
} from "./helpers.js";

const ORDER = "gid://shopify/Order/5001";

describe("orders/paid (F06-T1)", () => {
  let shopify;
  let listing;
  let wentLive;

  /** A paid fee order for `listing`; `changes` replace parts of the payload. */
  const payload = (changes = {}) => ({
    id: 5001,
    test: false,
    subtotal_price: "25.00",
    note_attributes: [{ name: "_classifieds_listing_id", value: listing.id }],
    // The pre-discount price is the fee variant's price ($30.00), the code takes $5.00 off.
    line_items: [{ variant_id: 777, quantity: 1, price: "30.00" }],
    discount_codes: [
      { code: discountCodeFor(listing.id, listing.paymentDueBy) },
    ],
    shipping_lines: [],
    ...changes,
  });
  const deliver = (changes) =>
    handleOrderPaid({ payload: payload(changes), admin: shopify.admin });
  const current = () =>
    prisma.listing.findUnique({ where: { id: listing.id } });

  beforeEach(async () => {
    await freshWorld();
    await seedFeeSetup();
    shopify = fakeAdmin();
    listing = await awaiting();
    wentLive = [];
    subscribe(EVENTS.ListingWentLive, (event) => wentLive.push(event));
  });

  it("AC: a matching fee order records the charge, fulfils silently and puts the listing live", async () => {
    await deliver();
    const charge = await prisma.feeCharge.findUnique({
      where: { orderGid: ORDER },
    });
    expect(charge).toMatchObject({
      listingId: listing.id,
      kind: "INITIAL",
      amountCents: 2500,
      status: "PAID",
    });
    expect(shopify.of("FeeFulfilmentCreate")).toEqual([
      {
        fulfillment: {
          lineItemsByFulfillmentOrder: [
            { fulfillmentOrderId: "gid://shopify/FulfillmentOrder/1" },
          ],
          notifyCustomer: false,
        },
      },
    ]);
    const after = await current();
    expect(after.status).toBe("LIVE");
    expect(after.billingMode).toBe("ONE_MONTH");
    expect(await problemKeys()).toEqual([]);
  });

  it("SEC: a duplicate orders/paid has one effect", async () => {
    await deliver();
    await deliver();
    expect(await prisma.feeCharge.count()).toBe(1);
    expect(wentLive).toHaveLength(1);
    expect(shopify.of("FeeFulfilmentCreate")).toHaveLength(1);
    expect(
      await prisma.auditEvent.count({ where: { action: "FeeChargeRecorded" } }),
    ).toBe(1);
    expect(await problemKeys()).toEqual([]);
  });

  it.each([
    [
      "an unknown listing id",
      {
        note_attributes: [
          { name: "_classifieds_listing_id", value: "c".repeat(25) },
        ],
      },
      "unmatched-order",
    ],
    [
      "an attribute that is not an id",
      {
        note_attributes: [{ name: "_classifieds_listing_id", value: "x'; --" }],
      },
      "unmatched-order",
    ],
    [
      "the fee variant without the attribute",
      { note_attributes: [] },
      "unmatched-order",
    ],
    [
      "the full price (discount removed)",
      { subtotal_price: "30.00", discount_codes: [] },
      "fee-mismatch",
    ],
    [
      "the right amount with another code",
      { discount_codes: [{ code: "SUMMER5" }] },
      "fee-mismatch",
    ],
    [
      "another variant",
      { line_items: [{ variant_id: 999, quantity: 1 }] },
      "fee-mismatch",
    ],
    [
      "an extra line",
      {
        line_items: [
          { variant_id: 777, quantity: 1 },
          { variant_id: 5, quantity: 1 },
        ],
      },
      "fee-mismatch",
    ],
    [
      "quantity 2",
      { line_items: [{ variant_id: 777, quantity: 2 }] },
      "fee-mismatch",
    ],
    [
      "a shipping line",
      { shipping_lines: [{ title: "Ground" }] },
      "fee-mismatch",
    ],
  ])(
    "SEC: %s raises an incident and does not publish",
    async (_name, changes, key) => {
      await deliver(changes);
      expect(await prisma.feeCharge.count()).toBe(0);
      expect((await current()).status).toBe("APPROVED_AWAITING_PAYMENT");
      expect(wentLive).toHaveLength(0);
      expect(await problemKeys()).toEqual([`${key}:${ORDER}`]);
    },
  );

  it("SEC: a foreign discount code is a DISCOUNT mismatch and publishes nothing", async () => {
    await deliver({ discount_codes: [{ code: "SUMMER5" }] });
    expect(await prisma.feeCharge.count()).toBe(0);
    expect((await current()).status).toBe("APPROVED_AWAITING_PAYMENT");
    expect(wentLive).toHaveLength(0);
    const problem = await prisma.auditEvent.findFirst({
      where: { action: "PaymentProblem" },
    });
    expect(problem.details).toMatchObject({ reason: "DISCOUNT" });
    expect(await problemKeys()).toEqual([`fee-mismatch:${ORDER}`]);
  });

  it("SEC: another listing's id with this listing's fee does not publish the other listing", async () => {
    const other = await awaiting({
      invitation: { feeRegularCents: 3000, feeOfferedCents: 1000 },
    });
    await deliver({
      note_attributes: [{ name: "_classifieds_listing_id", value: other.id }],
    });
    const after = await prisma.listing.findUnique({ where: { id: other.id } });
    expect(after.status).toBe("APPROVED_AWAITING_PAYMENT");
    expect(await prisma.feeCharge.count()).toBe(0);
    expect(await problemKeys()).toEqual([`fee-mismatch:${ORDER}`]);
  });

  it("SEC: a test order is refused in production unless staging allows it", async () => {
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await deliver({ test: true });
      expect((await current()).status).toBe("APPROVED_AWAITING_PAYMENT");
      process.env.FEE_TEST_ORDERS = "allow";
      await deliver({ test: true });
      expect((await current()).status).toBe("LIVE");
    } finally {
      process.env.NODE_ENV = env;
      delete process.env.FEE_TEST_ORDERS;
    }
  });

  it("AC: a payment on a lapsed listing is flagged, not published", async () => {
    await prisma.listing.update({
      where: { id: listing.id },
      data: { status: "LAPSED", closedAt: new Date() },
    });
    await deliver();
    const after = await current();
    expect(after.status).toBe("LAPSED");
    expect(after.refundFlag).toBe(true);
    expect(wentLive).toHaveLength(0);
    // The money was taken, so the charge is on record for the refund.
    expect(await prisma.feeCharge.count()).toBe(1);
    expect(await problemKeys()).toEqual([`late-payment:${ORDER}`]);
  });

  it("an ordinary store order is ignored without a write or a Shopify call", async () => {
    await deliver({
      note_attributes: [{ name: "gift", value: "yes" }],
      line_items: [{ variant_id: 42, quantity: 3 }],
      subtotal_price: "99.00",
      discount_codes: [],
    });
    await handleOrderPaid({ payload: null, admin: shopify.admin });
    expect(await prisma.feeCharge.count()).toBe(0);
    expect(await prisma.auditEvent.count()).toBe(0);
    expect(shopify.calls).toHaveLength(0);
  });

  it("a second, different order for the same listing is reported", async () => {
    await deliver();
    await deliver({ id: 5002 });
    expect(await prisma.feeCharge.count()).toBe(2);
    expect(wentLive).toHaveLength(1);
    expect(await problemKeys()).toEqual([`duplicate-fee-order:${listing.id}`]);
  });

  it("a fulfilment failure doesn't stop the listing going live, and asks for a retry", async () => {
    shopify = fakeAdmin({
      FeeOrderFulfilmentState: {
        order: {
          id: ORDER,
          displayFulfillmentStatus: "UNFULFILLED",
          fulfillmentOrders: { nodes: [] },
        },
      },
    });
    await expect(deliver()).rejects.toMatchObject({ code: "NOT_READY" });
    expect((await current()).status).toBe("LIVE");
    expect(await problemKeys()).toEqual([`fee-order-unfulfilled:${ORDER}`]);

    // The retried delivery only has the fulfilment left to do.
    shopify = fakeAdmin();
    await deliver();
    expect(shopify.of("FeeFulfilmentCreate")).toHaveLength(1);
    expect(await prisma.feeCharge.count()).toBe(1);
    expect(wentLive).toHaveLength(1);
  });

  it("a failed PaymentReceived reaches the webhook, and the retry finishes the job", async () => {
    const stop = subscribe(EVENTS.PaymentReceived, () => {
      throw new Error("database down");
    });
    await expect(deliver()).rejects.toThrow("database down");
    stop();
    await deliver();
    expect((await current()).status).toBe("LIVE");
    expect(await prisma.feeCharge.count()).toBe(1);
  });
});
