import { beforeEach, describe, expect, it } from "vitest";
import { addMonths, EVENTS, publish } from "@/modules/core/index.js";
import { discountCodeFor } from "@/modules/payments/services/discount.js";
import { handleOrderPaid } from "@/modules/payments/services/orders-paid.js";
import {
  awaiting,
  problemKeys,
  seedFeeSetup,
} from "@/modules/payments/tests/helpers.js";
import { runScheduled } from "@/modules/publishing/index.js";
import {
  addPhoto,
  CLOUDFRONT_PREFIX,
  fieldsOf,
  lastLiveCount,
  lastUpsert,
  outbox,
  prisma,
  publishingAdmin,
  publishingWorld,
  SELLER,
} from "./helpers.js";

const VARIANT = 777;

/** A paid fee order for `listing`, as Shopify sends it on `orders/paid`. */
const orderFor = (listing, id) => ({
  id,
  test: false,
  subtotal_price: "25.00",
  note_attributes: [{ name: "_classifieds_listing_id", value: listing.id }],
  line_items: [{ variant_id: VARIANT, quantity: 1, price: "30.00" }],
  discount_codes: [{ code: discountCodeFor(listing.id, listing.paymentDueBy) }],
  shipping_lines: [],
});

describe("Go live and the storefront page (F06-T2)", () => {
  let shopify;
  let listing;
  const pay = (id = 5001) =>
    handleOrderPaid({
      payload: orderFor(listing, id),
      admin: shopify.admin,
    });
  const current = () =>
    prisma.listing.findUnique({ where: { id: listing.id } });

  beforeEach(async () => {
    await publishingWorld();
    await seedFeeSetup();
    shopify = publishingAdmin();
    listing = await awaiting({
      askingPriceCents: 2500,
      condition: "Good",
      city: "Wichita",
      state: "KS",
      arrangements: ["PICKUP"],
      sellerDisplay: SELLER.name,
      invitation: { sellerName: SELLER.name, sellerEmail: SELLER.email },
    });
    await addPhoto(listing.id, 0);
    await addPhoto(listing.id, 1);
    // Not approved by staff: must never reach the page.
    await addPhoto(listing.id, 2, { approved: false });
  });

  it("AC: a paid listing is live at once, ACTIVE, with CloudFront photos and expires_at one month after live_at", async () => {
    await pay();
    const after = await current();
    expect(after.status).toBe("LIVE");
    expect(Date.now() - after.liveAt.getTime()).toBeLessThan(60_000);
    expect(after.expiresAt).toEqual(addMonths(after.liveAt, 1));

    const upsert = lastUpsert(shopify);
    expect(upsert.metaobject.capabilities.publishable.status).toBe("ACTIVE");
    const fields = fieldsOf(upsert);
    expect(fields.public_status).toBe("live");
    expect(fields.expires_at).toBe(after.expiresAt.toISOString());
    const photos = JSON.parse(fields.photos);
    expect(photos).toHaveLength(2);
    expect(photos.every((url) => url.startsWith(CLOUDFRONT_PREFIX))).toBe(true);
  });

  it("AC: the page's gid and handle are saved, and live_count is set to 1", async () => {
    await pay();
    const after = await current();
    const upsert = lastUpsert(shopify);
    expect(after.metaobjectHandle).toBe(upsert.handle.handle);
    expect(after.metaobjectGid).toBe(
      `gid://shopify/Metaobject/${after.metaobjectHandle}`,
    );
    expect(lastLiveCount(shopify)).toBe("1");
  });

  it("AC: listing_live is sent once, even when the event and the hourly task run again", async () => {
    await pay();
    const key = `listing_live:${listing.id}:${(await current()).liveAt.getTime()}:0`;
    expect(await outbox("listing_live")).toEqual([
      expect.objectContaining({ idempotencyKey: key }),
    ]);

    const after = await current();
    await publish(EVENTS.ListingWentLive, {
      listingId: listing.id,
      firstTime: true,
      expiresAt: after.expiresAt,
    });
    await runScheduled();
    expect(await outbox("listing_live")).toHaveLength(1);
  });

  it("AC: a duplicate orders/paid makes one ListingPeriod, ending at expiresAt", async () => {
    await pay();
    await pay();
    const periods = await prisma.listingPeriod.findMany({
      where: { listingId: listing.id },
    });
    const after = await current();
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({
      startsAt: after.liveAt,
      endsAt: after.expiresAt,
    });
    expect(await problemKeys()).toEqual([]);
  });

  it("AC: a second paid order for the same listing gets no period of its own", async () => {
    await pay(5001);
    await pay(5002);
    expect(
      await prisma.listingPeriod.count({ where: { listingId: listing.id } }),
    ).toBe(1);
    expect(
      await prisma.feeCharge.count({ where: { listingId: listing.id } }),
    ).toBe(2);
    expect(await problemKeys()).toContain(`duplicate-fee-order:${listing.id}`);
  });
});
