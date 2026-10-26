import { beforeEach, describe, expect, it } from "vitest";
import { EVENTS, subscribe } from "@/modules/core/index.js";
import { settlePaymentApplies } from "@/modules/payments/services/apply.js";
import { handlePay } from "@/modules/payments/services/pay-page.js";
import { payRef } from "@/modules/payments/services/pay-link.js";
import { runLapse, runReconcile } from "@/modules/payments/services/tasks.js";
import {
  awaiting,
  fakeAdmin,
  freshWorld,
  HOUR,
  ordersAnswer,
  paidOrderNode,
  prisma,
  problemKeys,
  seedFeeSetup,
  SHOP,
} from "./helpers.js";

const ORDER = "gid://shopify/Order/6001";

describe("Paid fee orders whose webhook was lost (F06-FIX-3)", () => {
  let listing;
  let wentLive;
  /** Shopify holds these paid fee orders. */
  const shopifyHas = (...nodes) =>
    fakeAdmin({ FeeOrdersPaid: ordersAnswer(nodes) });
  const status = async () =>
    (await prisma.listing.findUnique({ where: { id: listing.id } })).status;
  const overdue = () => new Date(listing.paymentDueBy.getTime() + HOUR);

  beforeEach(async () => {
    await freshWorld();
    await seedFeeSetup();
    listing = await awaiting();
    wentLive = [];
    subscribe(EVENTS.ListingWentLive, (event) => wentLive.push(event));
  });

  it("AC: the reconcile finds a paid order with no charge and puts the listing live once; a second run changes nothing", async () => {
    const shopify = shopifyHas(paidOrderNode(listing));
    expect(await runReconcile()).toEqual({
      checked: 1,
      recorded: 1,
      mismatched: 0,
      applied: 1,
    });
    expect(await status()).toBe("LIVE");
    const charge = await prisma.feeCharge.findUnique({
      where: { orderGid: ORDER },
    });
    expect(charge.appliedAt).not.toBeNull();
    expect(await runReconcile()).toMatchObject({ recorded: 0, applied: 0 });
    expect(wentLive).toHaveLength(1);
    expect(shopify.of("FeeFulfilmentCreate")).toHaveLength(1);
    expect(
      await prisma.auditEvent.count({
        where: { action: "FeeOrderReconciled" },
      }),
    ).toBe(1);
    expect(await problemKeys()).toEqual([]);
  });

  it("AC: a listing whose fee was paid but not recorded goes live at its deadline instead of lapsing", async () => {
    shopifyHas(paidOrderNode(listing));
    expect(await runLapse({ now: overdue() })).toMatchObject({
      lapsed: 0,
      errors: 0,
    });
    expect(await status()).toBe("LIVE");
  });

  it("a recorded charge that wasn't applied yet is applied, not lapsed", async () => {
    fakeAdmin();
    await prisma.feeCharge.create({
      data: {
        listingId: listing.id,
        kind: "INITIAL",
        orderGid: ORDER,
        amountCents: 2500,
        status: "PAID",
      },
    });
    expect(await runLapse({ now: overdue() })).toMatchObject({
      lapsed: 0,
      applied: 1,
    });
    await settlePaymentApplies();
    expect(await status()).toBe("LIVE");
  });

  it("AC: when Shopify can't be reached, nothing is lapsed that run", async () => {
    fakeAdmin({
      FeeOrdersPaid: () => {
        throw new Error("network down");
      },
    });
    expect(await runLapse({ now: overdue() })).toMatchObject({
      lapsed: 0,
      skipped: true,
    });
    expect(await status()).toBe("APPROVED_AWAITING_PAYMENT");
    expect(await problemKeys()).toEqual(["lapse-skipped"]);
  });

  it.each([
    [
      "a smaller amount",
      { subtotalPriceSet: { shopMoney: { amount: "20.0" } } },
    ],
    ["another code", { discountCodes: ["SUMMER5"] }],
    ["a shipping line", { shippingLines: { nodes: [{ id: "s1" }] } }],
  ])(
    "SEC: an order with %s is reported as a payment problem and never publishes",
    async (_name, changes) => {
      shopifyHas(paidOrderNode(listing, changes));
      expect(await runReconcile()).toMatchObject({ mismatched: 1, applied: 0 });
      await runReconcile();
      expect(await prisma.feeCharge.count()).toBe(0);
      expect(await status()).toBe("APPROVED_AWAITING_PAYMENT");
      expect(wentLive).toHaveLength(0);
      expect(await problemKeys()).toEqual([`fee-mismatch:${ORDER}`]);
    },
  );

  it("AC: the pay page for a paid but unrecorded order says it's paid and opens no checkout", async () => {
    const shopify = shopifyHas(paidOrderNode(listing));
    const ref = payRef(listing.id, listing.paymentDueBy);
    const ctx = {
      shop: SHOP,
      admin: shopify.admin,
      liquid: (body) => new Response(body),
    };
    const post = () =>
      handlePay(
        ctx,
        new Request(`https://x.example.test/apps/classifieds/pay/${ref}`, {
          method: "POST",
          headers: { "x-forwarded-for": "1.2.3.4" },
        }),
        ref,
      );
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("received your payment");
    expect(shopify.of("FeeDiscountByCode")).toHaveLength(0);
    expect(await prisma.feeCharge.count()).toBe(1);
    await settlePaymentApplies();
    expect(await status()).toBe("LIVE");
    expect(await (await post()).text()).toContain("already paid");
  });
});
