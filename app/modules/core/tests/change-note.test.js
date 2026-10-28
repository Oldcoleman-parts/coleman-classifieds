import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "@/../tests/db.js";
import { makeListing } from "@/../tests/factories.js";
import {
  transition,
  getChangesRequestNote,
  getSettings,
} from "@/modules/core/index.js";

const STAFF = { type: "STAFF", ref: "staff@example.test" };
const SELLER = { type: "SELLER" };

describe("getChangesRequestNote (AC: latest staff note for the seller page)", () => {
  beforeEach(async () => {
    await resetDb();
    await getSettings();
  });

  it("AC: returns the latest of two change requests", async () => {
    const listing = await makeListing({ status: "SUBMITTED" });
    await transition(listing.id, "REQUEST_CHANGES", STAFF, { note: "First note" });
    await transition(listing.id, "SUBMIT", SELLER);
    await transition(listing.id, "REQUEST_CHANGES", STAFF, { note: "Second note" });

    const found = await getChangesRequestNote(listing.id);

    expect(found.note).toBe("Second note");
    expect(found.at).toBeInstanceOf(Date);
  });

  it("AC: null when the listing has no change request", async () => {
    const listing = await makeListing({ status: "SUBMITTED" });

    expect(await getChangesRequestNote(listing.id)).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["missing", undefined],
    ["null", null],
    ["a number", 42],
  ])("AC: null for a %s id", async (_label, id) => {
    expect(await getChangesRequestNote(id)).toBeNull();
  });
});
