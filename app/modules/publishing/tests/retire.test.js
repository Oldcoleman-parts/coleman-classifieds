import { beforeEach, describe, expect, it } from "vitest";
import { retireListing } from "@/modules/publishing/index.js";
import { prisma, publishingAdmin, publishingWorld, seedListing } from "./helpers.js";

const GID = "gid://shopify/Metaobject/lantern-abc123";
const PATH = "/pages/classified-listing/lantern-abc123";

describe("Retiring a closed listing's page (F06-T2)", () => {
  let shopify;
  let listing;

  beforeEach(async () => {
    await publishingWorld();
    listing = await seedListing({
      status: "EXPIRED",
      photos: 0,
      metaobjectGid: GID,
      metaobjectHandle: "lantern-abc123",
      closedAt: new Date(),
    });
    shopify = publishingAdmin();
  });

  it("AC: the address redirects to the browse page, then the entry is deleted", async () => {
    expect(await retireListing(listing.id)).toEqual({ deleted: true });
    expect(shopify.of("RedirectCreate")).toEqual([
      { urlRedirect: { path: PATH, target: "/pages/classifieds" } },
    ]);
    expect(shopify.of("ListingDelete")).toEqual([{ id: GID }]);
    const after = await prisma.listing.findUnique({ where: { id: listing.id } });
    expect(after.metaobjectGid).toBeNull();
    expect(after.metaobjectHandle).toBe("lantern-abc123");
  });

  it("AC: an existing redirect is not created again, and a repeat run deletes nothing", async () => {
    shopify = publishingAdmin({
      RedirectByPath: { urlRedirects: { nodes: [{ id: "gid://shopify/UrlRedirect/9", path: PATH }] } },
    });
    await retireListing(listing.id);
    expect(shopify.of("RedirectCreate")).toEqual([]);
    expect(await retireListing(listing.id)).toEqual({ deleted: false });
    expect(shopify.of("ListingDelete")).toHaveLength(1);
  });

  it("AC: a listing that is not closed is refused, with no Shopify call", async () => {
    const live = await seedListing({ metaobjectGid: GID, metaobjectHandle: "live-one" });
    expect(await retireListing(live.id)).toEqual({ deleted: false });
    expect(shopify.calls).toEqual([]);
  });
});
