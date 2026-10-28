import { describe, it, expect, beforeAll } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing } from "@/../tests/factories.js";
import {
  countAuditEntries,
  listingsWithAuditEntry,
  ValidationError,
} from "@/modules/core";

// Seeds via create only: AuditEvent is append-only, so no update or delete here.
describe("core audit count helpers", () => {
  const ACTION = "PageRetireFailed";
  const SINCE = new Date("2026-01-10T00:00:00Z");
  const HOUR = 60 * 60 * 1000;
  let a, b, c, d;

  const seed = (listing, action, at, extra = {}) =>
    prisma.auditEvent.create({
      data: { listingId: listing.id, actor: "SYSTEM", action, at, ...extra },
    });

  beforeAll(async () => {
    await resetDb();
    [a, b, c, d] = [
      await makeListing(),
      await makeListing(),
      await makeListing(),
      await makeListing(),
    ];
    // A: one row before `since` (excluded), one exactly at `since` (counted), one after (counted),
    // and one of another action (excluded). B: one counted. D: noise, never passed in.
    // C: passed in but has no rows, so it is left out.
    await seed(a, ACTION, new Date(SINCE.getTime() - 24 * HOUR));
    await seed(a, ACTION, new Date(SINCE.getTime()));
    await seed(a, ACTION, new Date(SINCE.getTime() + HOUR));
    await seed(a, "PageRetireHeld", new Date(SINCE.getTime() + HOUR));
    await seed(b, ACTION, new Date(SINCE.getTime() + HOUR));
    await seed(d, ACTION, new Date(SINCE.getTime() + HOUR));
  });

  const ids = () => [a.id, b.id, c.id];

  it("AC: counts include only that action, those listings and at >= since", async () => {
    const counts = await countAuditEntries({
      action: ACTION,
      listingIds: ids(),
      since: SINCE,
    });

    expect(counts).toEqual(
      new Map([
        [a.id, 2],
        [b.id, 1],
      ]),
    );
    expect(counts.has(c.id)).toBe(false);
    expect(counts.has(d.id)).toBe(false);
  });

  it("AC: listingsWithAuditEntry returns a Set with the same filtering", async () => {
    const found = await listingsWithAuditEntry({
      action: ACTION,
      listingIds: ids(),
      since: SINCE,
    });

    expect(found).toBeInstanceOf(Set);
    expect(found).toEqual(new Set([a.id, b.id]));
  });

  it("AC: an empty id list returns an empty Map and Set", async () => {
    const query = { action: ACTION, listingIds: [], since: SINCE };

    expect(await countAuditEntries(query)).toEqual(new Map());
    expect(await listingsWithAuditEntry(query)).toEqual(new Set());
  });

  const valid = () => ({
    action: ACTION,
    listingIds: [a.id],
    since: SINCE,
  });
  const manyIds = Array.from({ length: 501 }, (_, i) => `listing-${i}`);

  it.each([
    ["action is not a string", { action: 123 }],
    ["action is empty", { action: "" }],
    ["action is whitespace only", { action: "   " }],
    ["action is over 100 characters", { action: "x".repeat(101) }],
    ["listingIds is not an array", { listingIds: "abc" }],
    ["listingIds has a malformed id", { listingIds: ["not a valid id!"] }],
    ["listingIds has more than 500 distinct ids", { listingIds: manyIds }],
    ["since is missing", { since: undefined }],
    ["since is a string", { since: "2026-01-10" }],
    ["since is an invalid Date", { since: new Date("not a date") }],
  ])("AC: %s is a ValidationError", async (_label, override) => {
    const query = { ...valid(), ...override };

    await expect(countAuditEntries(query)).rejects.toThrow(ValidationError);
    await expect(listingsWithAuditEntry(query)).rejects.toThrow(
      ValidationError,
    );
  });

  it("SEC: results hold only string keys and number values, never details or actors", async () => {
    const secret = "tok_live_SECRET_123";
    const secretRef = "leaked.staff@secret.example.test";
    await seed(c, ACTION, new Date(SINCE.getTime() + HOUR), {
      actor: "STAFF",
      actorRef: secretRef,
      details: { token: secret, email: secretRef },
    });

    const counts = await countAuditEntries({
      action: ACTION,
      listingIds: ids(),
      since: SINCE,
    });
    const found = await listingsWithAuditEntry({
      action: ACTION,
      listingIds: ids(),
      since: SINCE,
    });

    for (const [key, value] of counts) {
      expect(typeof key).toBe("string");
      expect(typeof value).toBe("number");
    }
    for (const key of found) expect(typeof key).toBe("string");

    const serialized = JSON.stringify([...counts.entries(), [...found]]);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(secretRef);
    expect(counts.get(c.id)).toBe(1);
  });
});
