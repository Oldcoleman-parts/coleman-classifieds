import { describe, it, expect, beforeAll } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing } from "@/../tests/factories.js";

// Raw SQL throughout, so this tests the database trigger rather than Prisma.
describe("AuditEvent append-only trigger", () => {
  let listing;

  beforeAll(async () => {
    await resetDb();
    listing = await makeListing();
  });

  const makeEvent = (action) =>
    prisma.auditEvent.create({
      data: { listingId: listing.id, actor: "SYSTEM", action },
    });

  const asPurgeRole = (statement) =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE classifieds_purge");
      return statement(tx);
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

  it("SEC: the purge role can DELETE but not UPDATE", async () => {
    const kept = await makeEvent("test.purge.update");
    const purged = await makeEvent("test.purge.delete");

    // The purge role has no UPDATE grant on AuditEvent, so this fails on permissions.
    await expect(
      asPurgeRole(
        (tx) =>
          tx.$executeRaw`UPDATE "AuditEvent" SET action = 'modified' WHERE id = ${kept.id}`,
      ),
    ).rejects.toThrow(/permission denied/);

    const deleted = await asPurgeRole(
      (tx) => tx.$executeRaw`DELETE FROM "AuditEvent" WHERE id = ${purged.id}`,
    );
    expect(deleted).toBe(1);
    expect(await prisma.auditEvent.count({ where: { id: purged.id } })).toBe(0);
  });
});
