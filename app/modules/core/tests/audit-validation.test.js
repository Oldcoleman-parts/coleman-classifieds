import { describe, it, expect, beforeAll } from "vitest";
import { resetDb } from "@/../tests/db.js";
import {
  listAuditEntries,
  openAuditExport,
  ValidationError,
} from "@/modules/core";

// AC (F01-FIX-11): invalid input to the History helpers is a ValidationError.
const VALID_CURSOR = "1000_abc123";
const DAY = 24 * 60 * 60 * 1000;
const day = new Date("2026-03-01T00:00:00Z");

async function rejectionOf(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to reject");
}

describe("audit History input validation", () => {
  beforeAll(async () => {
    await resetDb();
  });

  it.each([
    ["unknown filter key", () => listAuditEntries({ bogus: 1 }), "bogus"],
    [
      "bad listingId",
      () => listAuditEntries({ listingId: "a b" }),
      "listingId",
    ],
    [
      "action with a space",
      () => listAuditEntries({ action: "a b" }),
      "action",
    ],
    [
      "actor not in the list",
      () => listAuditEntries({ actor: "ADMIN" }),
      "actor",
    ],
    [
      "end equal to start",
      () => listAuditEntries({ start: day, end: day }),
      "end",
    ],
    [
      "end before start",
      () =>
        listAuditEntries({ start: day, end: new Date(day.getTime() - DAY) }),
      "end",
    ],
    [
      "invalid Date",
      () => listAuditEntries({ start: new Date("nope") }),
      "start",
    ],
    ["take 0", () => listAuditEntries({}, { take: 0 }), "take"],
    ["take 201", () => listAuditEntries({}, { take: 201 }), "take"],
    [
      "malformed after cursor",
      () => listAuditEntries({}, { after: "abc" }),
      "after",
    ],
    [
      "malformed before cursor",
      () => listAuditEntries({}, { before: "1_" }),
      "before",
    ],
    [
      "both after and before",
      () => listAuditEntries({}, { after: VALID_CURSOR, before: VALID_CURSOR }),
      "before",
    ],
    [
      "export batchSize 1001",
      () => openAuditExport({}, { batchSize: 1001 }),
      "batchSize",
    ],
  ])("AC: %s is a ValidationError", async (_name, call, field) => {
    const error = await rejectionOf(call());
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.fields).toHaveProperty(field);
  });
});
