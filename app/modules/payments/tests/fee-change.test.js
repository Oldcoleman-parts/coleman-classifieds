import { describe, it, expect, beforeEach, vi } from "vitest";
import { setStorefrontFetch } from "@/modules/payments/services/checkout.js";
import { onListingApproved } from "@/modules/payments/services/approval.js";
import { discountCodeFor } from "@/modules/payments/services/discount.js";
import { handleOrderPaid } from "@/modules/payments/services/orders-paid.js";
import { handlePay } from "@/modules/payments/services/pay-page.js";
import { payRef } from "@/modules/payments/services/pay-link.js";
import {
  awaiting,
  fakeAdmin,
  freshWorld,
  prisma,
  seedFeeSetup,
  SHOP,
  VARIANT,
  PRODUCT,
} from "./helpers.js";

const cents = (amount) => Math.round(Number(amount) * 100);
const money = (value) => (value / 100).toFixed(2);

describe("Fee changes after invitations (F06-FIX-1)", () => {
  // A stateful stand-in for the shop: the fee variant's price, and the discount codes by text.
  let shop;
  let admin;
  let nextId;

  const node = (code, entry) => ({
    id: entry.id,
    codeDiscount: {
      customerGets: { value: { amount: { amount: entry.amount } } },
    },
  });

  const answers = {
    FeeVariantPrice: () => ({
      productVariant: {
        id: VARIANT,
        price: shop.price,
        product: { id: PRODUCT },
      },
    }),
    FeeVariantUpdate: ({ variants }) => {
      shop.price = variants[0].price;
      return {
        productVariantsBulkUpdate: {
          productVariants: [{ id: VARIANT }],
          userErrors: [],
        },
      };
    },
    FeeDiscountByCode: ({ code }) => {
      const found = shop.codes.get(code);
      return { codeDiscountNodeByCode: found ? node(code, found) : null };
    },
    FeeDiscountCreate: ({ discount }) => {
      const id = `gid://shopify/DiscountCodeNode/${nextId++}`;
      shop.codes.set(discount.code, {
        id,
        amount: discount.customerGets.value.discountAmount.amount,
      });
      return {
        discountCodeBasicCreate: { codeDiscountNode: { id }, userErrors: [] },
      };
    },
    FeeDiscountUpdate: ({ id, discount }) => {
      const [, entry] = [...shop.codes].find(([, found]) => found.id === id);
      entry.amount = discount.customerGets.value.discountAmount.amount;
      return {
        discountCodeBasicUpdate: { codeDiscountNode: { id }, userErrors: [] },
      };
    },
  };

  /** A cart: the fee variant at the shop's price, less the amount of the code applied. */
  function storefront() {
    setStorefrontFetch(async (_url, init) => {
      const code = JSON.parse(init.body).variables.input.discountCodes?.[0];
      const off = code ? cents(shop.codes.get(code)?.amount) : 0;
      const total = cents(shop.price) - off;
      return {
        json: async () => ({
          data: {
            cartCreate: {
              cart: {
                totalQuantity: 1,
                checkoutUrl: `https://${SHOP}/cart/c/${nextId++}`,
                cost: { totalAmount: { amount: money(total) } },
                discountCodes: code ? [{ code, applicable: true }] : [],
              },
              userErrors: [],
            },
          },
        }),
      };
    });
  }

  const pay = (listing) =>
    handlePay(
      {
        shop: SHOP,
        admin,
        liquid: (body, init) =>
          new Response(body, {
            status: init?.status ?? 200,
            headers: init?.headers,
          }),
      },
      new Request("https://x.example.test/apps/classifieds/pay/ref", {
        method: "POST",
      }),
      payRef(listing.id, listing.paymentDueBy),
    );

  beforeEach(async () => {
    await freshWorld();
    await seedFeeSetup();
    shop = { price: "30.00", codes: new Map() };
    nextId = 1;
    admin = fakeAdmin(answers).admin;
    storefront();
  });

  it("AC: after a base fee change, a new invitation at the new fee and an older one at the old fee can both pay exactly their locked fee", async () => {
    // Base $30.00: the old invitation locks $25.00, so its code takes $5.00 off.
    const old = await awaiting({
      invitation: { feeRegularCents: 3000, feeOfferedCents: 2500 },
    });
    await onListingApproved({ listingId: old.id });
    const oldCode = discountCodeFor(old.id, old.paymentDueBy);
    expect(shop.codes.get(oldCode).amount).toBe("5.00");

    // Staff raise the base fee to $40.00; the new invitation locks $40.00 (no code).
    await prisma.settings.update({
      where: { id: 1 },
      data: { baseFeeCents: 4000 },
    });
    const fresh = await awaiting({
      invitation: { feeRegularCents: 4000, feeOfferedCents: 4000 },
    });
    await onListingApproved({ listingId: fresh.id });
    expect(shop.price).toBe("40.00");

    // Both sellers pay: each checkout comes to exactly its locked fee.
    expect((await pay(old)).status).toBe(303);
    expect((await pay(fresh)).status).toBe(303);
    expect(shop.price).toBe("40.00");
    expect(shop.codes.get(oldCode).amount).toBe("15.00");

    // Both orders publish their listings.
    const paid = (listing, id, subtotal, codes) =>
      handleOrderPaid({
        payload: {
          id,
          test: false,
          subtotal_price: subtotal,
          note_attributes: [
            { name: "_classifieds_listing_id", value: listing.id },
          ],
          line_items: [{ variant_id: 777, quantity: 1, price: "40.00" }],
          discount_codes: codes,
          shipping_lines: [],
        },
        admin,
      });
    await paid(old, 7001, "25.00", [{ code: oldCode }]);
    await paid(fresh, 7002, "40.00", []);
    for (const listing of [old, fresh]) {
      const after = await prisma.listing.findUnique({
        where: { id: listing.id },
      });
      expect(after.status).toBe("LIVE");
      expect(after.liveAt).not.toBeNull();
    }
    expect(await prisma.feeCharge.count()).toBe(2);
  });

  it("a locked fee above the current price records FEE_ABOVE_PRICE and makes no cart", async () => {
    const fetchSpy = vi.fn();
    setStorefrontFetch(fetchSpy);
    // The fee was lowered to $20.00 after this invitation locked $30.00.
    await prisma.settings.update({
      where: { id: 1 },
      data: { baseFeeCents: 2000 },
    });
    const listing = await awaiting({
      invitation: { feeRegularCents: 3000, feeOfferedCents: 3000 },
    });

    const response = await pay(listing);
    expect(response.status).toBe(200);
    expect(response.headers.get("Location")).toBeNull();
    expect(await response.text()).toContain("We couldn’t open the checkout");
    expect(fetchSpy).not.toHaveBeenCalled();
    const problem = await prisma.auditEvent.findFirst({
      where: { action: "PaymentProblem" },
    });
    expect(problem.details).toMatchObject({
      key: `checkout-failed:${listing.id}`,
      code: "FEE_ABOVE_PRICE",
    });
  });
});
