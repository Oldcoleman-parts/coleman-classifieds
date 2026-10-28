import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  onListingApproved,
  prepareForPayment,
} from "@/modules/payments/services/approval.js";
import { discountCodeFor } from "@/modules/payments/services/discount.js";
import { payRef } from "@/modules/payments/services/pay-link.js";
import {
  awaiting,
  BASE,
  breakSes,
  DAY,
  DISCOUNT,
  emailText,
  fakeAdmin,
  freshWorld,
  prisma,
  problemKeys,
  seedFeeSetup,
  SHOP,
  VARIANT,
} from "./helpers.js";

describe("Approval: discount code and pay email (F06-T1)", () => {
  let ses;
  beforeEach(async () => {
    ({ ses } = await freshWorld());
    await seedFeeSetup();
  });
  afterEach(() => vi.restoreAllMocks());

  it("AC: approval creates one single-use code for regular − offered and sends approved_pay", async () => {
    const shopify = fakeAdmin();
    const listing = await awaiting();
    const code = discountCodeFor(listing.id, listing.paymentDueBy);

    await onListingApproved({ listingId: listing.id });

    const [{ discount }] = shopify.of("FeeDiscountCreate");
    expect(discount).toMatchObject({
      code,
      usageLimit: 1,
      customerGets: {
        value: { discountAmount: { amount: "5.00", appliesOnEachItem: false } },
        items: { products: { productVariantsToAdd: [VARIANT] } },
      },
    });
    expect(new Date(discount.endsAt).getTime()).toBe(
      listing.paymentDueBy.getTime() + DAY,
    );
    const saved = await prisma.listing.findUnique({
      where: { id: listing.id },
    });
    expect(saved.discountCodeId).toBe(DISCOUNT);

    expect(ses.sent).toHaveLength(1);
    expect(ses.sent[0].input.Destination.ToAddresses).toEqual([
      listing.invitation.sellerEmail,
    ]);
    const text = emailText(ses);
    expect(text).toContain(
      `${BASE}/apps/classifieds/pay/${payRef(listing.id, listing.paymentDueBy)}`,
    );
    expect(text).toContain("$25.00");

    // A repeated event: no second email, and the stored id is unchanged.
    await onListingApproved({ listingId: listing.id });
    expect(ses.sent).toHaveLength(1);
    expect(
      await prisma.auditEvent.count({ where: { action: "DiscountCreated" } }),
    ).toBe(1);
  });

  it("a code that already exists (TAKEN) is adopted", async () => {
    // The lookup misses first (nothing yet), then finds the code another request made.
    let lookups = 0;
    const shopify = fakeAdmin({
      FeeDiscountByCode: () =>
        lookups++ === 0
          ? { codeDiscountNodeByCode: null }
          : {
              codeDiscountNodeByCode: {
                id: DISCOUNT,
                codeDiscount: {
                  customerGets: { value: { amount: { amount: "5.00" } } },
                },
              },
            },
      FeeDiscountCreate: {
        discountCodeBasicCreate: {
          codeDiscountNode: null,
          userErrors: [{ field: ["code"], code: "TAKEN", message: "taken" }],
        },
      },
    });
    const listing = await awaiting();
    const result = await prepareForPayment(listing.id, {
      admin: shopify.admin,
      shop: SHOP,
      fresh: true,
    });
    expect(result).toBe("DONE");
    expect(shopify.of("FeeDiscountByCode")).toHaveLength(2);
    const saved = await prisma.listing.findUnique({
      where: { id: listing.id },
    });
    expect(saved.discountCodeId).toBe(DISCOUNT);
  });

  it("no discount is created when the offered fee is the regular fee", async () => {
    const shopify = fakeAdmin();
    const listing = await awaiting({
      invitation: { feeRegularCents: 3000, feeOfferedCents: 3000 },
    });
    await onListingApproved({ listingId: listing.id });
    expect(shopify.of("FeeDiscountByCode")).toHaveLength(0);
    expect(shopify.of("FeeDiscountCreate")).toHaveLength(0);
    expect(ses.sent).toHaveLength(1);
  });

  it("AC: the price is synced before the code, and the code is price − offered", async () => {
    await prisma.settings.update({
      where: { id: 1 },
      data: { baseFeeCents: 4000 },
    });
    // The variant still sits at the old $30.00 price.
    const shopify = fakeAdmin();
    const listing = await awaiting(); // offered $25.00
    await onListingApproved({ listingId: listing.id });

    const names = shopify.calls.map((call) => call.name);
    expect(names.indexOf("FeeVariantUpdate")).toBeGreaterThan(-1);
    expect(names.indexOf("FeeVariantUpdate")).toBeLessThan(
      names.indexOf("FeeDiscountCreate"),
    );
    const [update] = shopify.of("FeeVariantUpdate");
    expect(update.variants[0]).toMatchObject({ price: "40.00" });
    const [{ discount }] = shopify.of("FeeDiscountCreate");
    expect(discount.customerGets.value.discountAmount.amount).toBe("15.00");
    expect(
      await prisma.auditEvent.count({ where: { action: "FeePriceSynced" } }),
    ).toBe(1);
  });

  it("a re-issue (new deadline) gives a new code, a new link and a new email", async () => {
    fakeAdmin();
    const listing = await awaiting();
    await onListingApproved({ listingId: listing.id });
    const paymentDueBy = new Date(listing.paymentDueBy.getTime() + 3 * DAY);
    await prisma.listing.update({
      where: { id: listing.id },
      data: { paymentDueBy },
    });
    await onListingApproved({ listingId: listing.id });
    expect(ses.sent).toHaveLength(2);
    expect(discountCodeFor(listing.id, paymentDueBy)).not.toBe(
      discountCodeFor(listing.id, listing.paymentDueBy),
    );
    expect(payRef(listing.id, paymentDueBy)).not.toBe(
      payRef(listing.id, listing.paymentDueBy),
    );
  });

  it("a listing that is not awaiting payment, or is past its deadline, is skipped", async () => {
    const shopify = fakeAdmin();
    const live = await awaiting({ status: "LIVE" });
    const late = await awaiting({ paymentDueBy: new Date(Date.now() - 1000) });
    for (const { id } of [live, late])
      expect(
        await prepareForPayment(id, { admin: shopify.admin, shop: SHOP }),
      ).toBe("SKIPPED");
    expect(shopify.calls).toHaveLength(0);
    expect(ses.sent).toHaveLength(0);
  });

  it("a failed email or a Shopify refusal never undoes the approval", async () => {
    const shopify = fakeAdmin();
    const listing = await awaiting();
    breakSes(ses);
    expect(
      await prepareForPayment(listing.id, {
        admin: shopify.admin,
        shop: SHOP,
        fresh: true,
      }),
    ).toBe("EMAIL_FAILED");

    fakeAdmin({
      FeeDiscountCreate: {
        discountCodeBasicCreate: {
          codeDiscountNode: null,
          userErrors: [{ code: "INTERNAL_ERROR", message: "x" }],
        },
      },
    });
    const other = await awaiting();
    await expect(
      onListingApproved({ listingId: other.id }),
    ).resolves.toBeUndefined();
    expect(await problemKeys()).toContain(`approval-setup:${other.id}`);
    const saved = await prisma.listing.findUnique({ where: { id: other.id } });
    expect(saved.status).toBe("APPROVED_AWAITING_PAYMENT");
  });

  it("SEC: the pay link and the code are in no log, outbox row or audit entry", async () => {
    const logs = [];
    for (const method of ["log", "error", "warn", "info"])
      vi.spyOn(console, method).mockImplementation((...args) =>
        logs.push(args.join(" ")),
      );
    fakeAdmin();
    const listing = await awaiting();
    await onListingApproved({ listingId: listing.id });

    const secrets = [
      payRef(listing.id, listing.paymentDueBy).split(".")[1],
      discountCodeFor(listing.id, listing.paymentDueBy),
    ];
    const stored = JSON.stringify([
      await prisma.emailOutbox.findMany(),
      await prisma.auditEvent.findMany(),
      logs,
    ]);
    for (const secret of secrets) expect(stored).not.toContain(secret);
    const [row] = await prisma.emailOutbox.findMany();
    expect(row.vars).toBeNull();
  });
});
