import { beforeEach, describe, expect, it } from "vitest";
import {
  getStorefrontCount,
  recomputeLiveCount,
} from "@/modules/publishing/index.js";
import { lastLiveCount, publishingAdmin, publishingWorld, seedListing } from "./helpers.js";

const entry = (status, live) => ({
  capabilities: { publishable: { status } },
  field: { value: live ? "live" : "closed" },
});

describe("Live count (F06-T2)", () => {
  let shopify;

  beforeEach(async () => {
    await publishingWorld();
    shopify = publishingAdmin();
  });

  it("AC: live_count is not written again when it is already right", async () => {
    await seedListing();
    shopify = publishingAdmin({
      ShopLiveCount: {
        shop: { id: "gid://shopify/Shop/1", currencyCode: "USD", metafield: { value: "1" } },
      },
    });
    expect(await recomputeLiveCount({ admin: shopify.admin })).toBe(1);
    expect(shopify.of("LiveCountSet")).toEqual([]);
  });

  it("SEC: live_count comes from the database, whatever Shopify holds", async () => {
    await seedListing();
    shopify = publishingAdmin({
      ShopLiveCount: {
        shop: { id: "gid://shopify/Shop/1", currencyCode: "USD", metafield: { value: "99" } },
      },
    });
    await recomputeLiveCount({ admin: shopify.admin });
    expect(lastLiveCount(shopify)).toBe("1");
  });

  it("AC: the storefront count counts only ACTIVE live entries, across pages", async () => {
    shopify = publishingAdmin({
      ListingEntries: ({ after }) =>
        after === null
          ? {
              metaobjects: {
                nodes: [entry("ACTIVE", true), entry("ACTIVE", false), entry("DRAFT", true)],
                pageInfo: { hasNextPage: true, endCursor: "c1" },
              },
            }
          : {
              metaobjects: {
                nodes: [entry("ACTIVE", true)],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
    });
    expect(await getStorefrontCount({ admin: shopify.admin })).toBe(2);
    expect(shopify.of("ListingEntries").map((v) => v.after)).toEqual([null, "c1"]);
  });

  it("AC: the storefront count is null when Shopify can't be asked", async () => {
    shopify = publishingAdmin({
      ListingEntries: () => {
        throw new Error("network down");
      },
    });
    expect(await getStorefrontCount({ admin: shopify.admin })).toBeNull();
  });
});
