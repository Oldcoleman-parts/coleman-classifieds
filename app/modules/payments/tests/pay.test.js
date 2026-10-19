import { describe, it, expect, beforeEach } from "vitest";
import { setStorefrontFetch } from "@/modules/payments/services/checkout.js";
import { discountCodeFor } from "@/modules/payments/services/discount.js";
import {
  handlePay,
  handlePayPage,
} from "@/modules/payments/services/pay-page.js";
import { payRef } from "@/modules/payments/services/pay-link.js";
import {
  awaiting,
  DAY,
  fakeAdmin,
  freshWorld,
  prisma,
  PRODUCT,
  problemKeys,
  seedFeeSetup,
  SF_TOKEN,
  SHOP,
  VARIANT,
} from "./helpers.js";

const CHECKOUT = `https://${SHOP}/cart/c/abc123`;
// The page titles the seller sees (every error page is status 200, see pay-page.js).
const COULDNT_OPEN = "We couldn’t open the checkout";
const WINDOW_PASSED = "The payment window has passed";
const LINK_INVALID = "This payment link doesn’t work";

describe("Pay page and checkout (F06-T1)", () => {
  let shopify;
  let carts;
  let listing;
  let ref;

  /** Answer `cartCreate`; `cart` replaces parts of a cart that charges the offered fee. */
  function storefront(cart = {}) {
    carts = [];
    setStorefrontFetch(async (url, init) => {
      const { variables } = JSON.parse(init.body);
      carts.push({ url, headers: init.headers, input: variables.input });
      const code = variables.input.discountCodes?.[0];
      return {
        json: async () => ({
          data: {
            cartCreate: {
              cart: {
                id: "gid://shopify/Cart/1",
                totalQuantity: 1,
                checkoutUrl: CHECKOUT,
                cost: { totalAmount: { amount: "25.0", currencyCode: "USD" } },
                discountCodes: code ? [{ code, applicable: true }] : [],
                ...cart,
              },
              userErrors: [],
            },
          },
        }),
      };
    });
  }

  const ctx = () => ({
    shop: SHOP,
    admin: shopify.admin,
    liquid: (body, init) =>
      new Response(body, {
        status: init?.status ?? 200,
        headers: init?.headers,
      }),
  });
  const request = (method, ip = "1.2.3.4") =>
    new Request(`https://x.example.test/apps/classifieds/pay/${ref}`, {
      method,
      headers: { "x-forwarded-for": ip },
    });
  const get = (options) => handlePayPage(ctx(), request("GET"), ref, options);
  const post = (options, ip) =>
    handlePay(ctx(), request("POST", ip), ref, options);

  beforeEach(async () => {
    await freshWorld();
    await seedFeeSetup();
    shopify = fakeAdmin();
    storefront();
    listing = await awaiting();
    ref = payRef(listing.id, listing.paymentDueBy);
  });

  it("GET shows the fee and a POST form, and starts nothing", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    const html = await response.text();
    expect(html).toContain("1962 Coleman 200A lantern");
    expect(html).toContain("$25.00");
    expect(html).toContain(
      `method="post" action="/apps/classifieds/pay/${ref}"`,
    );
    expect(carts).toHaveLength(0);
    expect(shopify.calls).toHaveLength(0);
  });

  it("AC: the cart carries the attribute, the seller's email and the code, and redirects to checkout", async () => {
    const response = await post();
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(CHECKOUT);

    expect(carts).toHaveLength(1);
    expect(carts[0].url).toBe(`https://${SHOP}/api/2026-07/graphql.json`);
    expect(carts[0].headers["X-Shopify-Storefront-Access-Token"]).toBe(
      SF_TOKEN,
    );
    expect(carts[0].input).toEqual({
      lines: [{ merchandiseId: VARIANT, quantity: 1 }],
      attributes: [{ key: "_classifieds_listing_id", value: listing.id }],
      buyerIdentity: { email: listing.invitation.sellerEmail },
      discountCodes: [discountCodeFor(listing.id, listing.paymentDueBy)],
    });
    expect(
      await prisma.auditEvent.count({
        where: { action: "CheckoutStarted", listingId: listing.id },
      }),
    ).toBe(1);
  });

  it.each([
    [
      "the code is not applicable",
      { discountCodes: [{ code: "X", applicable: false }] },
    ],
    [
      "the total is the full price",
      { cost: { totalAmount: { amount: "30.0" } } },
    ],
    [
      "the checkout is on another host",
      { checkoutUrl: "https://evil.example.test/c/1" },
    ],
    ["the checkout is not https", { checkoutUrl: `http://${SHOP}/cart/c/1` }],
  ])("AC: no redirect when %s", async (_name, cart) => {
    storefront(cart);
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get("Location")).toBeNull();
    expect(await response.text()).toContain(COULDNT_OPEN);
    expect(await problemKeys()).toEqual([`checkout-failed:${listing.id}`]);
  });

  it("AC: a refused checkout shows the app's own error page with status 200", async () => {
    storefront({ cost: { totalAmount: { amount: "30.0" } } });
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get("Location")).toBeNull();
    const html = await response.text();
    expect(html).toContain(COULDNT_OPEN);
    expect(html).toContain("you have not been charged");
    expect(await problemKeys()).toEqual([`checkout-failed:${listing.id}`]);
  });

  it("an empty cart records FEE_NOT_ON_CHANNEL and re-publishes", async () => {
    storefront({ totalQuantity: 0 });
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get("Location")).toBeNull();
    expect(await response.text()).toContain(COULDNT_OPEN);
    const problem = await prisma.auditEvent.findFirst({
      where: { action: "PaymentProblem" },
    });
    expect(problem.details).toMatchObject({
      key: `checkout-failed:${listing.id}`,
      code: "FEE_NOT_ON_CHANNEL",
    });
    expect(shopify.of("FeePublish")).toEqual([
      {
        id: PRODUCT,
        input: [{ publicationId: "gid://shopify/Publication/1" }],
      },
    ]);
  });

  it("SEC: a checkout after the deadline is refused", async () => {
    const after = { now: new Date(listing.paymentDueBy.getTime() + 1000) };
    for (const response of [await get(after), await post(after)]) {
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(WINDOW_PASSED);
    }

    // A lapsed listing, and a link signed for an earlier deadline (before a re-issue).
    await prisma.listing.update({
      where: { id: listing.id },
      data: { status: "LAPSED" },
    });
    expect(await (await post()).text()).toContain(WINDOW_PASSED);
    await prisma.listing.update({
      where: { id: listing.id },
      data: {
        status: "APPROVED_AWAITING_PAYMENT",
        paymentDueBy: new Date(listing.paymentDueBy.getTime() + DAY),
      },
    });
    expect(await (await post()).text()).toContain(LINK_INVALID);
    expect(carts).toHaveLength(0);
  });

  it("SEC: a wrong signature opens nothing, exactly like an unknown listing", async () => {
    const good = ref;
    ref = `${listing.id}.${"A".repeat(43)}`;
    const forged = await post();
    ref = `${"c".repeat(25)}.${good.split(".")[1]}`;
    const unknown = await get();
    ref = "not-a-ref";
    const malformed = await get();
    const [forgedHtml, unknownHtml, malformedHtml] = await Promise.all(
      [forged, unknown, malformed].map(async (response) => {
        expect(response.status).toBe(200);
        return response.text();
      }),
    );
    for (const html of [forgedHtml, unknownHtml, malformedHtml])
      expect(html).toContain(LINK_INVALID);
    expect(forgedHtml).toBe(unknownHtml);
    expect(carts).toHaveLength(0);
  });

  it("a listing that is already live gets the already-paid page", async () => {
    await prisma.listing.update({
      where: { id: listing.id },
      data: { status: "LIVE", liveAt: new Date() },
    });
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("already paid");
    expect(carts).toHaveLength(0);
  });

  it("SEC: the POST is rate-limited per IP and per listing", async () => {
    for (let i = 0; i < 10; i++) expect((await post()).status).toBe(303);
    const limited = await post();
    expect(limited.status).toBe(200);
    expect(await limited.text()).toContain("Please wait a moment");
    // Another IP is stopped by the listing's own limit (10 an hour).
    const other = await post(undefined, "5.6.7.8");
    expect(await other.text()).toContain("Please wait a moment");
    expect(carts).toHaveLength(10);
  });
});
