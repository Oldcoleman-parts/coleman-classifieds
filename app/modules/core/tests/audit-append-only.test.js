import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing } from "@/../tests/factories.js";
import { getSettings } from "@/modules/core/index.js";

// Raw SQL throughout, so this tests the database trigger rather than Prisma.
const DAY_MS = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY_MS);
const future = (days) => new Date(Date.now() + days * DAY_MS);

describe("AuditEvent append-only trigger", () => {
  let listing;

  beforeAll(async () => {
    await resetDb();
    await getSettings();
    listing = await makeListing();
  });

  afterEach(async () => {
    await prisma.settings.update({
      where: { id: 1 },
      data: { recordsRetentionDays: 365 },
    });
  });

  const makeEvent = (action, overrides = {}) =>
    prisma.auditEvent.create({
      data: { listingId: listing.id, actor: "SYSTEM", action, ...overrides },
    });

  const asPurgeRole = (statement) =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE classifieds_purge");
      return statement(tx);
    });

  const purgeDelete = (id) =>
    asPurgeRole(
      (tx) => tx.$executeRaw`DELETE FROM "AuditEvent" WHERE id = ${id}`,
    );

  const makeClosedListing = (purgeAfterDays) =>
    makeListing({
      status: "EXPIRED",
      closedAt: ago(400),
      closedReason: "EXPIRED",
      purgeAfter: purgeAfterDays,
    });

  it("SEC: audit_event_append_only pins search_path to pg_catalog first", async () => {
    const [fn] = await prisma.$queryRaw`
      SELECT proconfig FROM pg_proc
      WHERE proname = 'audit_event_append_only'
        AND pronamespace = current_schema()::regnamespace`;
    const searchPath = (fn?.proconfig ?? []).find((s) =>
      s.startsWith("search_path="),
    );
    expect(searchPath).toMatch(/^search_path=pg_catalog(,|$)/);
  });

  it("AC: INSERT still works", async () => {
    const event = await prisma.auditEvent.create({
      data: {
        listingId: listing.id,
        actor: "STAFF",
        actorRef: "staff@example.test",
        action: "approved",
        details: { reason: "looks good" },
      },
    });

    expect(event.listingId).toBe(listing.id);
    expect(event.actor).toBe("STAFF");
  });

  it("AC: UPDATE on AuditEvent is rejected by the database", async () => {
    const event = await makeEvent("test.update");

    await expect(
      prisma.$executeRaw`UPDATE "AuditEvent" SET action = 'modified' WHERE id = ${event.id}`,
    ).rejects.toThrow(/append-only/);

    const after = await prisma.auditEvent.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(after.action).toBe("test.update");
  });

  it("SEC: DELETE on AuditEvent is rejected", async () => {
    const event = await makeEvent("test.delete");

    await expect(
      prisma.$executeRaw`DELETE FROM "AuditEvent" WHERE id = ${event.id}`,
    ).rejects.toThrow(/append-only/);

    expect(await prisma.auditEvent.count({ where: { id: event.id } })).toBe(1);
  });

  it("SEC: TRUNCATE on AuditEvent is rejected", async () => {
    await makeEvent("test.truncate");

    await expect(
      prisma.$executeRawUnsafe('TRUNCATE "AuditEvent"'),
    ).rejects.toThrow(/append-only/);

    expect(await prisma.auditEvent.count()).toBeGreaterThan(0);
  });

  it("SEC: the purge role refuses a recent row of a listing not yet past purgeAfter", async () => {
    const open = await makeEvent("test.purge.recent");
    const closing = await makeClosedListing(future(30));
    const recent = await makeEvent("test.purge.future", {
      listingId: closing.id,
    });

    await expect(purgeDelete(recent.id)).rejects.toThrow(/append-only/);
    await expect(purgeDelete(open.id)).rejects.toThrow(/append-only/);
    expect(await prisma.auditEvent.count({ where: { id: recent.id } })).toBe(1);
  });

  it("SEC: the purge role refuses an old row of an open listing (purgeAfter null)", async () => {
    const old = await makeEvent("test.purge.open-old", { at: ago(400) });

    await expect(purgeDelete(old.id)).rejects.toThrow(/append-only/);
    expect(await prisma.auditEvent.count({ where: { id: old.id } })).toBe(1);
  });

  it("AC: the purge role may delete a listing's row once its purgeAfter has passed", async () => {
    const closed = await makeClosedListing(ago(35));
    const event = await makeEvent("test.purge.listing-past", {
      listingId: closed.id,
    });

    expect(await purgeDelete(event.id)).toBe(1);
    expect(await prisma.auditEvent.count({ where: { id: event.id } })).toBe(0);
  });

  it("AC: the purge role may delete a listing-less row older than retention", async () => {
    const old = await makeEvent("test.purge.global-old", {
      listingId: null,
      at: ago(400),
    });

    expect(await purgeDelete(old.id)).toBe(1);
  });

  it("SEC: the purge role refuses a listing-less row newer than retention", async () => {
    const recent = await makeEvent("test.purge.global-recent", {
      listingId: null,
      at: ago(10),
    });

    await expect(purgeDelete(recent.id)).rejects.toThrow(/append-only/);
    expect(await prisma.auditEvent.count({ where: { id: recent.id } })).toBe(1);
  });

  it("AC: a lowered Settings.recordsRetentionDays is honoured", async () => {
    const row = await makeEvent("test.purge.retention", {
      listingId: null,
      at: ago(60),
    });
    await expect(purgeDelete(row.id)).rejects.toThrow(/append-only/);

    await prisma.settings.update({
      where: { id: 1 },
      data: { recordsRetentionDays: 30 },
    });
    expect(await purgeDelete(row.id)).toBe(1);
  });

  it("SEC: the app role can't delete even an old row", async () => {
    const old = await makeEvent("test.app.old", {
      listingId: null,
      at: ago(400),
    });

    await expect(
      prisma.$executeRaw`DELETE FROM "AuditEvent" WHERE id = ${old.id}`,
    ).rejects.toThrow(/append-only/);
    expect(await prisma.auditEvent.count({ where: { id: old.id } })).toBe(1);
  });

  it("SEC: the purge role can't UPDATE, even an expired row", async () => {
    const closed = await makeClosedListing(ago(35));
    const event = await makeEvent("test.purge.update", {
      listingId: closed.id,
    });

    // The purge role has no UPDATE grant on AuditEvent, so this fails on permissions.
    await expect(
      asPurgeRole(
        (tx) =>
          tx.$executeRaw`UPDATE "AuditEvent" SET action = 'modified' WHERE id = ${event.id}`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("SEC: the purge role can't TRUNCATE", async () => {
    await makeEvent("test.purge.truncate");

    await expect(
      asPurgeRole((tx) => tx.$executeRawUnsafe('TRUNCATE "AuditEvent"')),
    ).rejects.toThrow(/append-only|permission denied/);
  });
});
