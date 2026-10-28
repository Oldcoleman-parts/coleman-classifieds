import { describe, it, expect, beforeAll } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing } from "@/../tests/factories.js";
import { listAuditEntries } from "@/modules/core";

// AC (F01-FIX-11): each filter and the keyset paging return exactly the matching entries,
// newest first. Ids are lowercase, equal length, so their order is the same in any collation.
const T0 = new Date("2026-03-01T00:00:00Z").getTime();
const at = (hours) => new Date(T0 + hours * 60 * 60 * 1000);

describe("listAuditEntries", () => {
  let a;
  let b;
  const seed = (id, listing, overrides) =>
    prisma.auditEvent.create({
      data: {
        id,
        listingId: listing?.id ?? null,
        actor: "SYSTEM",
        ...overrides,
      },
    });

  beforeAll(async () => {
    await resetDb();
    a = await makeListing({ title: "Lantern A" });
    b = await makeListing({ title: "Stove B" });
    await seed("e01", a, {
      action: "ListingApproved",
      actor: "STAFF",
      actorRef: "staff@example.test",
      at: at(0),
    });
    await seed("e02", b, {
      action: "PaymentReceived",
      actor: "SELLER",
      at: at(1),
    });
    await seed("e03", null, { action: "privacy.customers_redact", at: at(2) });
    await seed("e04", a, {
      action: "ListingApproved",
      actor: "STAFF",
      actorRef: "Other@Example.test",
      at: at(3),
    });
    await seed("e05", a, {
      action: "ListingPublished",
      actor: "BUYER",
      at: at(3),
    });
    await seed("e06", b, {
      action: "ListingPublished",
      actor: "SYSTEM",
      at: at(3),
    });
    await seed("e07", a, {
      action: "PaymentReceived",
      actor: "SELLER",
      at: at(4),
    });
    await seed("e08", b, {
      action: "ListingApproved",
      actor: "STAFF",
      actorRef: "staff@example.test",
      at: at(5),
    });
    await seed("e09", null, {
      action: "SettingsUpdated",
      actor: "STAFF",
      at: at(6),
    });
  });

  it.each([
    ["listingId", { listingId: "A" }, ["e07", "e05", "e04", "e01"]],
    ["action", { action: "ListingApproved" }, ["e08", "e04", "e01"]],
    ["actor", { actor: "SELLER" }, ["e07", "e02"]],
    [
      "actorRef (mixed case)",
      { actorRef: "STAFF@Example.TEST" },
      ["e08", "e01"],
    ],
    [
      "start inclusive, end exclusive",
      { start: at(1), end: at(4) },
      ["e06", "e05", "e04", "e03", "e02"],
    ],
    ["start only", { start: at(5) }, ["e09", "e08"]],
    ["end only", { end: at(1) }, ["e01"]],
  ])(
    "AC: filter by %s returns the matching ids newest first",
    async (_name, filter, expected) => {
      const { entries } = await listAuditEntries(
        {
          ...filter,
          listingId: filter.listingId === "A" ? a.id : filter.listingId,
        },
        { take: 200 },
      );
      expect(entries.map((entry) => entry.id)).toEqual(expected);
    },
  );

  it("AC: paging follows nextCursor to the end, then prevCursor back, each row once in order", async () => {
    const expected = [
      "e09",
      "e08",
      "e07",
      "e06",
      "e05",
      "e04",
      "e03",
      "e02",
      "e01",
    ];

    const first = await listAuditEntries({}, { take: 2 });
    expect(first.prevCursor).toBeNull();
    expect(first.nextCursor).not.toBeNull();

    const pages = [first];
    let page = first;
    while (page.nextCursor) {
      page = await listAuditEntries({}, { take: 2, after: page.nextCursor });
      pages.push(page);
    }
    expect(page.nextCursor).toBeNull();
    expect(pages.flatMap((p) => p.entries.map((e) => e.id))).toEqual(expected);

    // Back from the last page to the first, one `before` cursor at a time.
    const back = [page];
    while (back[0].prevCursor) {
      back.unshift(
        await listAuditEntries({}, { take: 2, before: back[0].prevCursor }),
      );
    }
    expect(back).toHaveLength(pages.length);
    expect(back[0].prevCursor).toBeNull();
    expect(back.flatMap((p) => p.entries.map((e) => e.id))).toEqual(expected);
  });

  it("AC: listingTitle is set for a listing's row and null for a listing-less row", async () => {
    const { entries } = await listAuditEntries(
      { action: "ListingApproved" },
      { take: 200 },
    );
    const withListing = entries.find((e) => e.id === "e01");
    expect(withListing.listingId).toBe(a.id);
    expect(withListing.listingTitle).toBe("Lantern A");

    const { entries: global } = await listAuditEntries({
      action: "privacy.customers_redact",
    });
    expect(global[0].listingId).toBeNull();
    expect(global[0].listingTitle).toBeNull();
  });
});
