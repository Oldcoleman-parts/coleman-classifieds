import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeListing } from "@/../tests/factories.js";
import {
  loadHistoryScreen,
  parseHistoryFilter,
  streamHistoryCsv,
} from "@/modules/console/index.js";
import { setUp, tearDown, prisma, staffActor } from "./helpers.js";

const NOW = new Date("2026-10-27T12:00:00Z");
const DAY = 86_400_000;

describe("F05-T3: History list periods and rows", () => {
  let listing;
  let recent;
  let old;

  beforeEach(async () => {
    await setUp();
    listing = await makeListing();
    await prisma.listing.update({
      where: { id: listing.id },
      data: { title: "Coleman 220 lantern" },
    });
    const add = (at, listingId) =>
      prisma.auditEvent.create({
        data: { listingId, actor: "SYSTEM", action: "Checked", at },
      });
    recent = await add(new Date(NOW.getTime() - 3 * DAY), listing.id);
    old = await add(new Date(NOW.getTime() - 60 * DAY), null);
  });

  afterEach(() => {
    tearDown();
  });

  it.each([
    ["7", ["recent"]],
    ["90", ["recent", "old"]],
  ])(
    "AC: the quick period %s days lists only entries inside it",
    async (period, expected) => {
      const result = await loadHistoryScreen({ period }, { now: NOW });
      const names = { [recent.id]: "recent", [old.id]: "old" };
      expect(result.rows.map((row) => names[row.id])).toEqual(expected);
      expect(result.values.period).toBe(period);
      expect(result.range).toEqual({
        from: expect.any(String),
        to: "2026-10-27",
      });
    },
  );

  it("AC: no filters means the last 30 days, shown as that period", async () => {
    const result = await loadHistoryScreen({}, { now: NOW });
    expect(result.values.period).toBe("30");
    expect(result.rows.map((row) => row.id)).toEqual([recent.id]);
  });

  it("AC: an unknown period is a field error", async () => {
    const result = await loadHistoryScreen({ period: "12" }, { now: NOW });
    expect(result.fieldErrors.period).toBeTruthy();
    expect(result.rows).toEqual([]);
  });

  it("AC: the form's 'any' choices are no filter: a listing id alone shows its full history", async () => {
    const result = await loadHistoryScreen(
      {
        listingId: listing.id,
        period: "all",
        from: "",
        to: "",
        action: "any",
        actor: "any",
        staffEmail: "",
      },
      { now: NOW },
    );
    expect(result.fieldErrors).toEqual({});
    expect(result.rows.map((row) => row.id)).toEqual([recent.id]);
    expect(result.values).toMatchObject({
      period: "all",
      action: "",
      actor: "",
    });
  });

  it("AC: custom dates with the 'any' choices filter by the dates only", async () => {
    const result = await loadHistoryScreen(
      {
        period: "custom",
        from: "2026-08-01",
        to: "2026-10-27",
        action: "any",
        actor: "any",
      },
      { now: NOW },
    );
    expect(result.fieldErrors).toEqual({});
    expect(result.rows).toHaveLength(2);
  });

  it("AC: all dates without a listing id is a field error", async () => {
    const result = await loadHistoryScreen({ period: "all" }, { now: NOW });
    expect(result.fieldErrors.period).toMatch(/listing/);
  });

  it("AC: a listing opened from its page shows All dates", async () => {
    const result = await loadHistoryScreen(
      { listingId: listing.id },
      { now: NOW },
    );
    expect(result.values.period).toBe("all");
  });

  it("AC: a row shows the listing title and separate date and time", async () => {
    const result = await loadHistoryScreen({ period: "7" }, { now: NOW });
    const [row] = result.rows;
    expect(row.listingTitle).toBe("Coleman 220 lantern");
    expect(row.dateLabel).toMatch(/2026/);
    expect(row.timeLabel).not.toBe("");
  });

  it("AC: an export by quick period records the actual dates", async () => {
    const filter = parseHistoryFilter({ period: "7" }, { now: NOW });
    const { stream } = await streamHistoryCsv(filter, staffActor);
    await new Response(stream).text();
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "HistoryExported" },
    });
    expect(audit.details).toMatchObject({
      period: "7",
      from: "2026-10-20",
      to: "2026-10-27",
    });
  });
});
