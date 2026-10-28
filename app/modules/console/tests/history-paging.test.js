import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadHistoryScreen } from "@/modules/console/index.js";
import { setUp, tearDown, prisma } from "./helpers.js";

const NOW = new Date("2026-10-27T12:00:00Z");
const MINUTE = 60_000;
const FILTER = { action: "Paged", period: "7" };

describe("F05-FIX-1: History paging by cursor", () => {
  beforeEach(async () => {
    await setUp();
    // 120 entries, three to a timestamp, so cursors must break ties on id.
    await prisma.auditEvent.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        actor: "SYSTEM",
        action: "Paged",
        details: {},
        at: new Date(NOW.getTime() - Math.floor(i / 3) * MINUTE),
      })),
    });
  });

  afterEach(() => {
    tearDown();
  });

  it("AC: paging forward and back over 120 entries returns each once, in order", async () => {
    // The expected order is the database's own (at desc, id desc).
    const expected = (
      await prisma.auditEvent.findMany({
        where: { action: "Paged" },
        orderBy: [{ at: "desc" }, { id: "desc" }],
        select: { id: true },
      })
    ).map((row) => row.id);
    expect(new Set(expected).size).toBe(120);

    const page1 = await loadHistoryScreen(FILTER, { now: NOW });
    expect(page1.prevCursor).toBeNull();
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await loadHistoryScreen(
      { ...FILTER, after: page1.nextCursor },
      { now: NOW },
    );
    const page3 = await loadHistoryScreen(
      { ...FILTER, after: page2.nextCursor },
      { now: NOW },
    );
    expect(page3.nextCursor).toBeNull();
    expect(page3.rows).toHaveLength(20);

    const forward = [page1, page2, page3].flatMap((page) =>
      page.rows.map((row) => row.id),
    );
    expect(forward).toEqual(expected);

    // Back from page 3 to page 2, then to page 1.
    const back2 = await loadHistoryScreen(
      { ...FILTER, before: page3.prevCursor },
      { now: NOW },
    );
    expect(back2.rows.map((row) => row.id)).toEqual(
      page2.rows.map((row) => row.id),
    );
    const back1 = await loadHistoryScreen(
      { ...FILTER, before: back2.prevCursor },
      { now: NOW },
    );
    expect(back1.rows.map((row) => row.id)).toEqual(
      page1.rows.map((row) => row.id),
    );
    expect(back1.prevCursor).toBeNull();
  });
});
