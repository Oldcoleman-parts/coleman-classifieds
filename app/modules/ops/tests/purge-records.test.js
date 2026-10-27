import { describe, it, expect, beforeEach } from "vitest";
import { makeListing } from "@/../tests/factories.js";
import { runPurgeRecords } from "@/modules/ops/services/purge-records.js";
import { getSettings } from "@/modules/core/index.js";
import { DAY_MS, opsWorld, prisma } from "./helpers.js";

const ago = (days) => new Date(Date.now() - days * DAY_MS);
const future = (days) => new Date(Date.now() + days * DAY_MS);

/** A listing closed a year-plus ago, past purgeAfter, with no storefront page. */
const expiredListing = (overrides = {}) =>
  makeListing({
    status: "EXPIRED",
    closedAt: ago(400),
    closedReason: "EXPIRED",
    purgeAfter: ago(35),
    ...overrides,
  });

/** One row in each table a listing owns (and its invitation's email code). */
async function seedRows(listing, { photoDeletedAt = ago(1) } = {}) {
  const listingId = listing.id;
  await prisma.auditEvent.create({
    data: { listingId, actor: "SYSTEM", action: "test.seed" },
  });
  await prisma.photo.create({
    data: {
      listingId,
      privateKey: `private/${listingId}/1.jpg`,
      position: 0,
      uploadedBy: "STAFF",
      deletedAt: photoDeletedAt,
    },
  });
  await prisma.listingRevision.create({
    data: { listingId, changes: {}, photoIds: [] },
  });
  await prisma.listingTimeAdjustment.create({
    data: {
      listingId,
      type: "TECHNICAL_EXTENSION",
      minutes: 60,
      reason: "test",
      staff: "staff@example.test",
    },
  });
  await prisma.listingPeriod.create({
    data: { listingId, startsAt: ago(400), endsAt: ago(370) },
  });
  await prisma.feeCharge.create({
    data: {
      listingId,
      kind: "INITIAL",
      orderGid: `gid://shopify/Order/${listingId}`,
      amountCents: 3000,
      status: "PAID",
    },
  });
  await prisma.termsAcceptance.create({
    data: {
      listingId,
      rulesVersion: "draft-0",
      ip: "203.0.113.7",
      userAgent: "test",
    },
  });
  await prisma.buyerMessage.create({
    data: {
      listingId,
      buyerName: "Pat Buyer",
      buyerEmail: "buyer@example.test",
      body: "Is it available?",
      ip: "203.0.113.8",
      status: "DELIVERED",
      holdReasons: [],
    },
  });
  await prisma.alertQueue.create({ data: { listingId } });
  await prisma.emailCode.create({
    data: {
      invitationId: listing.invitationId,
      codeHash: "hash",
      expiresAt: future(1),
    },
  });
}

/** Row counts of everything a listing owns, for "untouched" and "gone" checks. */
async function rowCounts(listing) {
  const where = { listingId: listing.id };
  const codeWhere = { invitationId: listing.invitationId };
  return {
    audit: await prisma.auditEvent.count({ where }),
    photos: await prisma.photo.count({ where }),
    revisions: await prisma.listingRevision.count({ where }),
    adjustments: await prisma.listingTimeAdjustment.count({ where }),
    periods: await prisma.listingPeriod.count({ where }),
    charges: await prisma.feeCharge.count({ where }),
    terms: await prisma.termsAcceptance.count({ where }),
    messages: await prisma.buyerMessage.count({ where }),
    alerts: await prisma.alertQueue.count({ where }),
    codes: await prisma.emailCode.count({ where: codeWhere }),
    invitation: await prisma.invitation.count({
      where: { id: listing.invitationId },
    }),
    listing: await prisma.listing.count({ where: { id: listing.id } }),
  };
}

const ZERO = {
  audit: 0,
  photos: 0,
  revisions: 0,
  adjustments: 0,
  periods: 0,
  charges: 0,
  terms: 0,
  messages: 0,
  alerts: 0,
  codes: 0,
  invitation: 0,
  listing: 0,
};

const EMPTY = {
  listings: 0,
  auditRows: 0,
  globalAuditRows: 0,
  waitingPhotos: 0,
  failed: 0,
  skipped: 0,
  held: 0,
  globalFailed: 0,
};

describe("ops.purge-records (F08-T4)", () => {
  beforeEach(async () => {
    await opsWorld();
  });

  it("AC: an expired listing and a closed INVITED record leave no rows in any table", async () => {
    const expired = await expiredListing();
    await seedRows(expired);
    const invited = await expiredListing({
      status: "INVITED",
      closedReason: "INVITATION_EXPIRED",
    });
    await seedRows(invited);

    const summary = await runPurgeRecords();

    expect(summary).toMatchObject({ listings: 2, auditRows: 2, failed: 0 });
    expect(await rowCounts(expired)).toEqual(ZERO);
    expect(await rowCounts(invited)).toEqual(ZERO);
  });

  it("SEC: a listing whose purgeAfter is still ahead, and an open listing, are untouched", async () => {
    const closing = await makeListing({
      status: "EXPIRED",
      closedAt: ago(10),
      closedReason: "EXPIRED",
      purgeAfter: future(355),
    });
    const open = await makeListing({ status: "LIVE", liveAt: ago(5) });
    await seedRows(closing);
    await seedRows(open);
    const before = [await rowCounts(closing), await rowCounts(open)];

    const summary = await runPurgeRecords();

    expect(summary.listings).toBe(0);
    expect([await rowCounts(closing), await rowCounts(open)]).toEqual(before);
  });

  it("AC: a listing with a stored photo waits for the photo task and is counted", async () => {
    const waiting = await expiredListing();
    await seedRows(waiting, { photoDeletedAt: null });
    const before = await rowCounts(waiting);

    const summary = await runPurgeRecords();

    expect(summary).toMatchObject({ ...EMPTY, waitingPhotos: 1 });
    expect(await rowCounts(waiting)).toEqual(before);
  });

  it("AC: a listing that still has a storefront page (metaobjectGid) is untouched", async () => {
    const onStorefront = await expiredListing({
      metaobjectGid: "gid://shopify/Metaobject/1",
      metaobjectHandle: "lantern-1",
    });
    await seedRows(onStorefront);
    const before = await rowCounts(onStorefront);

    const summary = await runPurgeRecords();

    expect(summary.listings).toBe(0);
    expect(await rowCounts(onStorefront)).toEqual(before);
  });

  it("AC: a listing with audit rows deletes without a trigger error", async () => {
    const listing = await expiredListing();
    await seedRows(listing);
    await prisma.auditEvent.create({
      data: { listingId: listing.id, actor: "STAFF", action: "approved" },
    });

    const summary = await runPurgeRecords();

    expect(summary.failed).toBe(0);
    expect(summary.auditRows).toBe(2);
    expect((await rowCounts(listing)).audit).toBe(0);
  });

  it("AC: two runs have one effect", async () => {
    await seedRows(await expiredListing());

    await runPurgeRecords();
    const second = await runPurgeRecords();

    expect(second).toEqual(EMPTY);
    expect(
      await prisma.auditEvent.count({ where: { action: "RecordsPurged" } }),
    ).toBe(1);
  });

  it("AC: at most 50 listings are purged a run; the rest follow on the next run", async () => {
    for (let i = 0; i < 51; i++) await expiredListing();

    expect((await runPurgeRecords()).listings).toBe(50);
    expect((await runPurgeRecords()).listings).toBe(1);
    expect(await prisma.listing.count()).toBe(0);
  });

  it("AC: listing-less audit rows past retention are deleted, the rest are kept", async () => {
    const settings = await getSettings();
    const event = (data) =>
      prisma.auditEvent.create({
        data: { actor: "SYSTEM", action: "test.global", ...data },
      });
    const oldRow = await event({ at: ago(400) });
    const recentRow = await event({ at: ago(10) });
    const settingsUpdated = (to, at) =>
      event({
        action: "SettingsUpdated",
        at,
        details: { changes: { rulesVersion: { from: "x", to } } },
      });
    const keptVersion = await settingsUpdated("rules-kept", ago(400));
    const currentVersion = await settingsUpdated(
      settings.rulesVersion,
      ago(400),
    );
    const unusedVersion = await settingsUpdated("rules-unused", ago(400));
    // A listing that keeps the agreed wording (its acceptance is not purged).
    const seller = await makeListing({ status: "LIVE", liveAt: ago(5) });
    await prisma.termsAcceptance.create({
      data: {
        listingId: seller.id,
        rulesVersion: "rules-kept",
        ip: "203.0.113.7",
        userAgent: "test",
      },
    });

    const summary = await runPurgeRecords();

    expect(summary.globalAuditRows).toBe(2);
    const survivors = (
      await prisma.auditEvent.findMany({
        where: { listingId: null, action: { not: "RecordsPurged" } },
        select: { id: true },
      })
    ).map(({ id }) => id);
    expect(survivors.sort()).toEqual(
      [keptVersion.id, currentVersion.id, recentRow.id].sort(),
    );
    expect(survivors).not.toContain(oldRow.id);
    expect(survivors).not.toContain(unusedVersion.id);
  });

  it("AC: a rules version referred to only by a purged listing's acceptance is not kept", async () => {
    const listing = await expiredListing();
    await seedRows(listing);
    await prisma.termsAcceptance.updateMany({
      where: { listingId: listing.id },
      data: { rulesVersion: "rules-gone" },
    });
    const row = await prisma.auditEvent.create({
      data: {
        actor: "SYSTEM",
        action: "SettingsUpdated",
        at: ago(400),
        details: { changes: { rulesVersion: { from: "x", to: "rules-gone" } } },
      },
    });

    await runPurgeRecords();

    expect(await prisma.auditEvent.count({ where: { id: row.id } })).toBe(0);
  });

  it("SEC: RecordsPurged holds counts only, no ids or emails", async () => {
    await seedRows(await expiredListing());

    await runPurgeRecords();

    const { details } = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "RecordsPurged" },
    });
    expect(Object.keys(details).sort()).toEqual(Object.keys(EMPTY).sort());
    expect(Object.values(details).every(Number.isInteger)).toBe(true);
  });
});
