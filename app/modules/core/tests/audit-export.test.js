import { describe, it, expect, beforeAll } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing } from "@/../tests/factories.js";
import { openAuditExport } from "@/modules/core";

// AC (F01-FIX-11): the CSV batch reader is oldest first, bounded at open time.
const T0 = new Date("2026-03-01T00:00:00Z").getTime();
const at = (hours) => new Date(T0 + hours * 60 * 60 * 1000);

async function drain(exp) {
  const batches = [];
  for (;;) {
    const batch = await exp.next();
    if (batch.length === 0) return batches;
    batches.push(batch);
  }
}

describe("openAuditExport", () => {
  let listing;
  const ACTION = "ExportTest";

  beforeAll(async () => {
    await resetDb();
    listing = await makeListing();
    // Five matching rows; two share `at`, so the id tie-break decides their order.
    const rows = [
      ["x3", 2],
      ["x1", 0],
      ["x5", 4],
      ["x4", 2],
      ["x2", 1],
    ];
    for (const [id, hours] of rows)
      await prisma.auditEvent.create({
        data: {
          id,
          listingId: listing.id,
          actor: "SYSTEM",
          action: ACTION,
          at: at(hours),
        },
      });
  });

  it("AC: batches of 2 cover every matching row once, oldest first in (at, id) order", async () => {
    const exp = await openAuditExport({ action: ACTION }, { batchSize: 2 });
    expect(exp.empty).toBe(false);
    const batches = await drain(exp);
    const ids = batches.flat().map((entry) => entry.id);
    expect(batches.every((batch) => batch.length <= 2)).toBe(true);
    expect(ids).toEqual(["x1", "x2", "x3", "x4", "x5"]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(batches.flat().every((entry) => entry.listingTitle === null)).toBe(
      true,
    );
  });

  it("AC: a row written after the export is opened is left out", async () => {
    const exp = await openAuditExport({ action: ACTION }, { batchSize: 2 });
    const late = await prisma.auditEvent.create({
      data: {
        id: "x9",
        listingId: listing.id,
        actor: "SYSTEM",
        action: ACTION,
        at: at(100),
      },
    });

    const ids = (await drain(exp)).flat().map((entry) => entry.id);
    expect(ids).not.toContain(late.id);
    expect(ids).toHaveLength(5);
  });

  it("AC: a filter matching nothing is empty, and next() returns []", async () => {
    const exp = await openAuditExport({ action: "NoSuchAction" });
    expect(exp.empty).toBe(true);
    expect(await exp.next()).toEqual([]);
  });
});
