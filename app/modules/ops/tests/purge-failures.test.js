import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeListing } from "@/../tests/factories.js";
import { runPurgeRecords } from "@/modules/ops/services/purge-records.js";
import {
  purgeExpiredAuditEntries,
  runAsPurgeRole,
} from "@/modules/core/index.js";
import { DAY_MS, opsWorld, prisma } from "./helpers.js";

const HOUR_MS = 60 * 60 * 1000;

// Failure paths of the records purge (F08-FIX-7). The two collaborators that can fail are
// swapped for pass-throughs that fail on demand.
const state = vi.hoisted(() => ({ failMessagesFor: null, rulesError: null }));

vi.mock("@/modules/workspace/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    referencedRulesVersions: async () => {
      if (state.rulesError) throw state.rulesError;
      return actual.referencedRulesVersions();
    },
  };
});

vi.mock("@/modules/contact/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    purgeListingMessages: async (tx, listingId) => {
      if (listingId === state.failMessagesFor)
        throw Object.assign(new Error("boom"), { code: "PURGE_TEST_FAILURE" });
      return actual.purgeListingMessages(tx, listingId);
    },
  };
});

const ago = (days) => new Date(Date.now() - days * DAY_MS);

/** A listing closed a year ago, past purgeAfter, with no storefront page. */
const expiredListing = (overrides = {}) =>
  makeListing({
    status: "EXPIRED",
    closedAt: ago(400),
    closedReason: "EXPIRED",
    purgeAfter: ago(35),
    ...overrides,
  });

/** One row in each table a listing owns that the failure paths touch. */
async function seedRows(listing) {
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
      deletedAt: ago(1),
    },
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
}

/** Row counts of what a listing owns, plus the listing itself. */
async function rowCounts(listing) {
  const where = { listingId: listing.id };
  return {
    audit: await prisma.auditEvent.count({ where }),
    photos: await prisma.photo.count({ where }),
    charges: await prisma.feeCharge.count({ where }),
    terms: await prisma.termsAcceptance.count({ where }),
    messages: await prisma.buyerMessage.count({ where }),
    listing: await prisma.listing.count({ where: { id: listing.id } }),
  };
}

/** Listing A (purgeAfter 35 days ago, three recent failures) and B (20 days ago, clean). */
async function heldSetup() {
  const a = await expiredListing({ purgeAfter: ago(35) });
  const b = await expiredListing({ purgeAfter: ago(20) });
  await seedRows(a);
  await seedRows(b);
  for (let i = 0; i < 3; i++) {
    await prisma.auditEvent.create({
      data: {
        listingId: a.id,
        actor: "SYSTEM",
        action: "PurgeFailed",
        at: ago(1),
        details: { code: "PURGE_TEST_FAILURE" },
      },
    });
  }
  return { a, b };
}

describe("ops.purge-records failures (F08-FIX-7)", () => {
  let warn;

  beforeEach(async () => {
    await opsWorld();
    vi.spyOn(console, "error").mockImplementation(() => {});
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    state.failMessagesFor = null;
    state.rulesError = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("AC: a failing global audit step still purges the listing and writes one RecordsPurged", async () => {
    const listing = await expiredListing();
    await seedRows(listing);
    state.rulesError = new Error("db down");

    const summary = await runPurgeRecords();

    expect(summary).toMatchObject({ listings: 1, failed: 0, globalFailed: 1 });
    expect(await prisma.listing.count({ where: { id: listing.id } })).toBe(0);
    const rows = await prisma.auditEvent.findMany({
      where: { action: "RecordsPurged" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].details).toMatchObject({ listings: 1, globalFailed: 1 });
  });

  it("AC: a listing whose purge throws is rolled back, audited as PurgeFailed, and the run goes on", async () => {
    const a = await expiredListing({ purgeAfter: ago(35) });
    const b = await expiredListing({ purgeAfter: ago(20) });
    await seedRows(a);
    await seedRows(b);
    const before = await rowCounts(a);
    state.failMessagesFor = a.id;

    const summary = await runPurgeRecords();

    expect(summary).toMatchObject({ listings: 1, failed: 1 });
    // Rolled back: only the new PurgeFailed row is added to A's audit rows.
    expect(await rowCounts(a)).toEqual({ ...before, audit: before.audit + 1 });
    const failed = await prisma.auditEvent.findMany({
      where: { action: "PurgeFailed" },
    });
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ listingId: a.id, actor: "SYSTEM" });
    expect(failed[0].details).toEqual({ code: "PURGE_TEST_FAILURE" });
    expect((await rowCounts(b)).listing).toBe(0);
  });

  it("AC: a listing with 3 PurgeFailed in 7 days is held and audited once; the run purges the rest", async () => {
    const { a, b } = await heldSetup();
    const before = await rowCounts(a);

    const first = await runPurgeRecords();
    const second = await runPurgeRecords();

    expect(first).toMatchObject({ listings: 1, held: 1, failed: 0 });
    expect(second).toMatchObject({ listings: 0, held: 1, failed: 0 });
    expect((await rowCounts(b)).listing).toBe(0);
    // A is untouched by the purge; only the one PurgeHeld row is added.
    expect(await rowCounts(a)).toEqual({ ...before, audit: before.audit + 1 });
    const held = await prisma.auditEvent.findMany({
      where: { action: "PurgeHeld" },
    });
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ listingId: a.id });
    expect(held[0].details).toEqual({ failures: 3 });
  });

  it("SEC: the held listing is logged by id only, with no seller email", async () => {
    const { a } = await heldSetup();

    await runPurgeRecords();

    const text = warn.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(text).toContain(a.id);
    expect(text).not.toContain(a.invitation.sellerEmail);
    expect(text).not.toMatch(/@/);
  });

  // The app clock is moved, the database's is not; the purge must follow the database.
  it.each([
    ["ahead", 2],
    ["behind", -40],
  ])(
    "AC: with the app clock %s by %d days, rows past the database's retention are purged",
    async (_label, days) => {
      const listing = await expiredListing({ purgeAfter: ago(35) });
      await seedRows(listing);
      const oldRow = await prisma.auditEvent.create({
        data: {
          actor: "SYSTEM",
          action: "test.global",
          at: new Date(Date.now() - 366 * DAY_MS),
        },
      });
      const keptRow = await prisma.auditEvent.create({
        data: {
          actor: "SYSTEM",
          action: "test.global",
          at: new Date(Date.now() - 365 * DAY_MS + HOUR_MS),
        },
      });

      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + days * DAY_MS);
      const summary = await runPurgeRecords();

      expect(summary).toMatchObject({
        listings: 1,
        failed: 0,
        globalFailed: 0,
        globalAuditRows: 1,
      });
      expect((await rowCounts(listing)).listing).toBe(0);
      expect(await prisma.auditEvent.count({ where: { id: oldRow.id } })).toBe(
        0,
      );
      expect(await prisma.auditEvent.count({ where: { id: keptRow.id } })).toBe(
        1,
      );
    },
  );

  it("AC: with the app clock ahead, a listing whose purgeAfter is an hour away is untouched and not failed", async () => {
    const later = await expiredListing({
      purgeAfter: new Date(Date.now() + HOUR_MS),
    });
    await seedRows(later);
    const before = await rowCounts(later);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 2 * DAY_MS);
    const summary = await runPurgeRecords();

    expect(summary).toMatchObject({ listings: 0, failed: 0 });
    expect(await rowCounts(later)).toEqual(before);
  });

  it("AC: purgeExpiredAuditEntries keeps a SettingsUpdated row whose rules version is a plain string", async () => {
    const settingsUpdated = (to) =>
      prisma.auditEvent.create({
        data: {
          actor: "SYSTEM",
          action: "SettingsUpdated",
          at: ago(400),
          details: { changes: { rulesVersion: { from: "x", to } } },
        },
      });
    const kept = await settingsUpdated("v2026.10 final");
    const dropped = await settingsUpdated("rules-unused");

    const deleted = await runAsPurgeRole((tx) =>
      purgeExpiredAuditEntries(tx, { keepRulesVersions: ["v2026.10 final"] }),
    );

    expect(deleted).toBe(1);
    expect(await prisma.auditEvent.count({ where: { id: kept.id } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { id: dropped.id } })).toBe(
      0,
    );
  });
});
