import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { makeListing } from "@/../tests/factories.js";
import { loadHistoryScreen } from "@/modules/console/index.js";
import { setUp, tearDown, prisma } from "./helpers.js";

const NOW = new Date("2026-10-27T12:00:00Z");

// Seeded entries, keyed so expectations read as newest first.
const SEED = {
  a: {
    listing: 1,
    at: "2026-10-01T12:00:00Z",
    action: "ListingSubmitted",
    actor: "SELLER",
    actorRef: "seller@example.test",
  },
  b: {
    listing: 1,
    at: "2026-10-05T12:00:00Z",
    action: "ListingApproved",
    actor: "STAFF",
    actorRef: "Staff@Example.test",
  },
  c: {
    listing: 2,
    at: "2026-10-10T12:00:00Z",
    action: "ListingApproved",
    actor: "STAFF",
    actorRef: "other@example.test",
  },
  d: {
    listing: 2,
    at: "2026-10-20T12:00:00Z",
    action: "PaymentReceived",
    actor: "SYSTEM",
    actorRef: null,
  },
  e: {
    listing: 1,
    at: "2026-10-25T12:00:00Z",
    action: "ListingApproved",
    actor: "STAFF",
    actorRef: "staff@example.test",
  },
};

describe("F05-T3: History list", () => {
  let ids;
  let listings;

  beforeAll(async () => {
    await setUp();
  });

  beforeEach(async () => {
    await setUp();
    listings = [await makeListing(), await makeListing()];
    ids = {};
    for (const [key, row] of Object.entries(SEED)) {
      const event = await prisma.auditEvent.create({
        data: {
          listingId: listings[row.listing - 1].id,
          actor: row.actor,
          actorRef: row.actorRef,
          action: row.action,
          details: { note: `note ${key}` },
          at: new Date(row.at),
        },
      });
      ids[event.id] = key;
    }
  });

  afterEach(() => {
    tearDown();
  });

  /** The seed keys of the rows on screen, in order. */
  const keysOf = (result) => result.rows.map((row) => ids[row.id]);

  it.each([
    ["date range", { from: "2026-10-04", to: "2026-10-11" }, ["c", "b"]],
    ["listing", () => ({ listingId: listings[0].id }), ["e", "b", "a"]],
    ["action", { action: "ListingApproved" }, ["e", "c", "b"]],
    ["actor", { actor: "SELLER" }, ["a"]],
    ["actor SYSTEM", { actor: "SYSTEM" }, ["d"]],
    [
      "staff email in mixed case",
      { staffEmail: "STAFF@Example.test" },
      ["e", "b"],
    ],
    [
      "combination",
      () => ({
        listingId: listings[0].id,
        from: "2026-10-02",
        to: "2026-10-30",
        action: "ListingApproved",
      }),
      ["e", "b"],
    ],
  ])(
    "AC: %s filter returns only matching entries, newest first",
    async (_label, query, expected) => {
      const result = await loadHistoryScreen(
        typeof query === "function" ? query() : query,
        { now: NOW },
      );
      expect(result.fieldErrors).toEqual({});
      expect(keysOf(result)).toEqual(expected);
    },
  );

  it("AC: 51 matching entries page as 50 then 1", async () => {
    await prisma.auditEvent.createMany({
      data: Array.from({ length: 51 }, (_, i) => ({
        listingId: listings[0].id,
        actor: "SYSTEM",
        action: "Bulk",
        details: {},
        at: new Date(Date.UTC(2026, 9, 20, 12, i)),
      })),
    });
    const first = await loadHistoryScreen(
      { action: "Bulk", page: "1" },
      { now: NOW },
    );
    expect(first.rows).toHaveLength(50);
    expect(first.hasNext).toBe(true);
    expect(first.page).toBe(1);

    const second = await loadHistoryScreen(
      { action: "Bulk", page: "2" },
      { now: NOW },
    );
    expect(second.rows).toHaveLength(1);
    expect(second.hasNext).toBe(false);
    expect(second.page).toBe(2);
  });

  it("AC: a page that is not a number shows page 1", async () => {
    const result = await loadHistoryScreen({ page: "abc" }, { now: NOW });
    expect(result.page).toBe(1);
  });

  it.each([
    ["bad date", { from: "2026-13-01", to: "2026-10-11" }, "from"],
    ["end before start", { from: "2026-10-11", to: "2026-10-04" }, "to"],
    ["range over 366 days", { from: "2025-01-01", to: "2026-10-11" }, "to"],
    ["unknown actor", { actor: "ALIEN" }, "actor"],
    [
      "staff email with actor SELLER",
      { actor: "SELLER", staffEmail: "x@example.test" },
      "staffEmail",
    ],
    ["malformed action", { action: "bad action!" }, "action"],
  ])(
    "AC: invalid filter (%s) gives a field error and no rows",
    async (_label, query, field) => {
      const result = await loadHistoryScreen(query, { now: NOW });
      expect(result.fieldErrors[field]).toBeDefined();
      expect(result.rows).toEqual([]);
    },
  );

  it("AC: several bad filters are reported together", async () => {
    const result = await loadHistoryScreen(
      {
        from: "2026-13-01",
        to: "2026-10-11",
        actor: "ALIEN",
        action: "bad action!",
      },
      { now: NOW },
    );
    expect(Object.keys(result.fieldErrors).sort()).toEqual([
      "action",
      "actor",
      "from",
    ]);
    expect(result.rows).toEqual([]);
  });

  it("AC: a bad start date is reported even when the end date is missing", async () => {
    const result = await loadHistoryScreen(
      { from: "2026-13-01" },
      { now: NOW },
    );
    expect(Object.keys(result.fieldErrors).sort()).toEqual(["from", "to"]);
    expect(result.fieldErrors.from).toMatch(/date/);
  });

  it("SEC: rows carry no details and a seller row has no staff email", async () => {
    const result = await loadHistoryScreen({}, { now: NOW });
    for (const row of result.rows) expect(row).not.toHaveProperty("details");
    const seller = result.rows.find((row) => row.actor === "SELLER");
    expect(seller.staffEmail).toBeNull();
  });

  it("AC: actions lists each distinct action, sorted", async () => {
    const result = await loadHistoryScreen({}, { now: NOW });
    const expected = [
      ...new Set(Object.values(SEED).map((row) => row.action)),
    ].sort();
    expect(result.actions).toEqual(expected);
  });
});
