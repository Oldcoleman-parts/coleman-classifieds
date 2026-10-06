import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/../tests/db.js";
import { getPublicUrls } from "@/modules/media/index.js";
import { action as live } from "@/routes/proxy.seller.$token_.live.jsx";
import { action as photoDelete } from "@/routes/proxy.seller.$token_.photo-delete.jsx";
import { action as revision } from "@/routes/proxy.seller.$token_.revision.jsx";
import { action as sold } from "@/routes/proxy.seller.$token_.sold.jsx";
import { action as start } from "@/routes/proxy.seller.$token_.start.jsx";
import { action as uploadUrl } from "@/routes/proxy.seller.$token_.upload-url.jsx";
import {
  call,
  COMPLETE,
  DAY_MS,
  listingOf,
  sellerWith,
  setUp,
  tearDown,
} from "./helpers.js";

const liveSeller = (photos = [true]) =>
  sellerWith(
    {
      status: "LIVE",
      ...COMPLETE,
      liveAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * DAY_MS),
    },
    { photos },
  );

const audits = (listingId, action) =>
  prisma.auditEvent.findMany({ where: { listingId, action } });

describe("A live listing (AC4)", () => {
  beforeEach(() => setUp());
  afterEach(tearDown);

  it("AC4: price, quantity and note change at once, without a revision", async () => {
    const seller = await liveSeller();

    const response = await call(live, seller, {
      askingPrice: "75",
      quantityAvailable: "3",
      availabilityNote: "3 of 5 left",
    });

    expect(response.status).toBe(200);
    expect(await listingOf(seller)).toMatchObject({
      askingPriceCents: 7500,
      quantityAvailable: 3,
      availabilityNote: "3 of 5 left",
    });
    const [event] = await audits(seller.listing.id, "ListingUpdatedImmediate");
    expect(event.details.fields).toEqual([
      "askingPrice",
      "quantityAvailable",
      "availabilityNote",
    ]);
    expect(await prisma.listingRevision.count()).toBe(0);
  });

  it("AC4 + SEC: a new title and photo wait for review; the public page is unchanged", async () => {
    const seller = await liveSeller([true, false]);
    const [approved, added] = seller.photoIds;
    await prisma.photo.update({
      where: { id: approved },
      data: { publicKeyBase: "public/abc" },
    });
    const before = await getPublicUrls(seller.listing.id);

    await call(revision, seller, {
      title: "Coleman 200A lantern, with case",
      description: COMPLETE.description,
    });

    const [pending] = await prisma.listingRevision.findMany();
    expect(pending).toMatchObject({
      status: "PENDING",
      changes: { title: "Coleman 200A lantern, with case" },
      photoIds: [added],
    });
    expect((await listingOf(seller)).title).toBe(COMPLETE.title);
    expect(await getPublicUrls(seller.listing.id)).toEqual(before);
    expect(
      (await prisma.photo.findUnique({ where: { id: added } })).publicKeyBase,
    ).toBeNull();
    expect(await audits(seller.listing.id, "RevisionSubmitted")).toHaveLength(
      1,
    );
  });

  it("AC4: no new photos while a revision is with staff", async () => {
    const seller = await liveSeller();
    await prisma.listingRevision.create({
      data: { listingId: seller.listing.id, changes: {}, photoIds: [] },
    });

    const response = await call(uploadUrl, seller, {
      contentType: "image/jpeg",
      byteSize: "1000",
    });

    expect(response.status).toBe(409);
    expect((await response.json()).ok).toBe(false);
  });

  it("AC4: the last approved photo can't be removed", async () => {
    const seller = await liveSeller([true]);

    const response = await call(photoDelete, seller, {
      photoId: seller.photoIds[0],
    });

    expect(response.status).toBe(409);
    expect(
      (await prisma.photo.findUnique({ where: { id: seller.photoIds[0] } }))
        .deletedAt,
    ).toBeNull();
  });

  it("AC4: marking sold asks first, then closes the listing", async () => {
    const seller = await liveSeller();

    const asked = await (await call(sold, seller, {})).text();
    expect(asked).toContain("Mark as sold?");
    expect((await listingOf(seller)).status).toBe("LIVE");

    await call(sold, seller, { confirm: "yes" });
    expect((await listingOf(seller)).status).toBe("SOLD");
  });

  it("AC4: no path adds a listing or merchandise", async () => {
    const seller = await liveSeller();

    const response = await call(start, seller, {});

    expect(response.status).toBe(409);
    expect((await listingOf(seller)).status).toBe("LIVE");
    expect(await prisma.listing.count()).toBe(1);
  });
});
