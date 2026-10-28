import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/../tests/db.js";
import {
  LISTING_EVENTS,
  resetEventBus,
  transition,
} from "@/modules/core/index.js";
import { register } from "@/modules/workspace/index.js";
import { action as revision } from "@/routes/proxy.seller.$token_.revision.jsx";
import {
  call,
  COMPLETE,
  DAY_MS,
  listingOf,
  sellerWith,
  setUp,
  STAFF,
  tearDown,
} from "./helpers.js";

const NEW_TITLE = "Coleman 200A lantern, with case";
const NEW_DESCRIPTION =
  "Red 1951 lantern with its original metal case and a manual.";

const liveSeller = (photos) =>
  sellerWith(
    {
      status: "LIVE",
      ...COMPLETE,
      liveAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * DAY_MS),
    },
    { photos },
  );

/** A PENDING revision, as the seller page creates it. */
const pendingRevision = (seller, data = {}) =>
  prisma.listingRevision.create({
    data: {
      listingId: seller.listing.id,
      changes: { title: NEW_TITLE, description: NEW_DESCRIPTION },
      photoIds: [],
      ...data,
    },
  });

const decide = (seller, rev, event, photoIds = []) =>
  transition(seller.listing.id, LISTING_EVENTS[event], STAFF, {
    revisionId: rev.id,
    ...(event === "APPROVE_REVISION" ? { photoIds } : {}),
  });

const revisionOf = (rev) =>
  prisma.listingRevision.findUniqueOrThrow({ where: { id: rev.id } });

describe("Staff decisions on a revision (F04-FIX-1)", () => {
  beforeEach(async () => {
    await setUp();
    resetEventBus();
    register();
  });
  afterEach(() => {
    tearDown();
    resetEventBus();
  });

  it("AC: an approved revision updates the listing; the seller can send another", async () => {
    const seller = await liveSeller([true]);
    const rev = await pendingRevision(seller);

    await decide(seller, rev, "APPROVE_REVISION");

    expect(await listingOf(seller)).toMatchObject({
      title: NEW_TITLE,
      description: NEW_DESCRIPTION,
      status: "LIVE",
    });
    const decided = await revisionOf(rev);
    expect(decided).toMatchObject({ status: "APPROVED", decidedBy: STAFF.ref });
    expect(decided.decidedAt).toBeInstanceOf(Date);
    const again = await call(revision, seller, {
      title: "Coleman 200A lantern, case and globe",
      description: NEW_DESCRIPTION,
    });
    expect(again.status).toBe(200);
    expect(
      await prisma.listingRevision.count({ where: { status: "PENDING" } }),
    ).toBe(1);
  });

  it("AC: a rejected revision's new photos are deleted; the listing is unchanged", async () => {
    const seller = await liveSeller([true, false]);
    const [kept, added] = seller.photoIds;
    const rev = await pendingRevision(seller, { photoIds: [added, kept] });

    await decide(seller, rev, "REJECT_REVISION");

    expect(await revisionOf(rev)).toMatchObject({
      status: "REJECTED",
      decidedBy: STAFF.ref,
    });
    expect(await listingOf(seller)).toMatchObject({ title: COMPLETE.title });
    const photos = await prisma.photo.findMany({
      where: { listingId: seller.listing.id },
    });
    expect(photos.find((p) => p.id === added).deletedAt).toBeInstanceOf(Date);
    // An approved photo named in the revision stays: it may be live.
    expect(photos.find((p) => p.id === kept).deletedAt).toBeNull();
  });

  it.each(["APPROVE_REVISION", "REJECT_REVISION"])(
    "AC: a repeated %s changes nothing",
    async (event) => {
      const seller = await liveSeller([true]);
      const rev = await pendingRevision(seller);
      await decide(seller, rev, event);
      const first = await revisionOf(rev);
      await prisma.listing.update({
        where: { id: seller.listing.id },
        data: { title: "Changed since" },
      });

      await decide(seller, rev, event);

      expect(await revisionOf(rev)).toEqual(first);
      expect((await listingOf(seller)).title).toBe("Changed since");
    },
  );

  it("SEC: a revision of another listing is ignored", async () => {
    const seller = await liveSeller([true]);
    const other = await liveSeller([true]);
    const rev = await pendingRevision(other);

    await decide(seller, rev, "APPROVE_REVISION");

    expect((await revisionOf(rev)).status).toBe("PENDING");
    expect((await listingOf(seller)).title).toBe(COMPLETE.title);
    expect((await listingOf(other)).title).toBe(COMPLETE.title);
  });

  it.each([
    [
      "extra keys are dropped",
      { title: NEW_TITLE, askingPriceCents: 1, status: "SOLD" },
      "APPROVED",
      NEW_TITLE,
    ],
    [
      "an over-long title applies nothing",
      { title: "x".repeat(121) },
      "PENDING",
      COMPLETE.title,
    ],
    [
      "HTML applies nothing",
      { title: "<b>Lantern</b> deal" },
      "PENDING",
      COMPLETE.title,
    ],
  ])(
    "SEC: stored changes are checked again: %s",
    async (_, changes, status, title) => {
      const seller = await liveSeller([true]);
      const rev = await pendingRevision(seller, { changes });

      await decide(seller, rev, "APPROVE_REVISION");

      expect((await revisionOf(rev)).status).toBe(status);
      expect(await listingOf(seller)).toMatchObject({
        title,
        askingPriceCents: COMPLETE.askingPriceCents,
        status: "LIVE",
      });
    },
  );
});
