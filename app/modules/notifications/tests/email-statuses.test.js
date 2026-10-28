import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { mockSes } from "@/../tests/factories.js";
import { ValidationError } from "@/modules/core/index.js";
import {
  getEmailStatuses,
  send,
  setSesClient,
} from "@/modules/notifications/index.js";

const ADDRESS = "pat@example.test";
const VARS = {
  seller_first_name: "Pat",
  item_summary: "lantern",
  invitation_link: "https://example.test/apps/classifieds/seller/x",
  invitation_expiry_date: "November 4, 2026",
  staff_first_name: "Alex",
};

/** A row in a given status, written directly (the status is what is under test). */
function makeRow(idempotencyKey, status) {
  return prisma.emailOutbox.create({
    data: {
      templateKey: "invitation",
      stream: "transactional",
      toAddress: ADDRESS,
      status,
      idempotencyKey,
    },
  });
}

describe("Batch email status read (F03-FIX-5)", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
    process.env.SES_FROM_TRANSACTIONAL = "transactional@example.test";
    process.env.SES_CONFIG_SET_TRANSACTIONAL = "tx-set";
  });

  afterEach(() => {
    setSesClient(null);
  });

  it("AC: rows for some keys give a Map of exactly those keys with their status", async () => {
    setSesClient(mockSes());
    await send("invitation", ADDRESS, VARS, { idempotencyKey: "batch:sent" });
    await makeRow("batch:failed", "FAILED");
    await makeRow("batch:pending", "PENDING");

    const statuses = await getEmailStatuses([
      "batch:sent",
      "batch:failed",
      "batch:pending",
      "batch:unknown",
    ]);

    expect([...statuses.keys()].sort()).toEqual([
      "batch:failed",
      "batch:pending",
      "batch:sent",
    ]);
    expect(statuses.get("batch:sent")).toBe("SENT");
    expect(statuses.get("batch:failed")).toBe("FAILED");
    expect(statuses.get("batch:pending")).toBe("PENDING");
    expect(statuses.has("batch:unknown")).toBe(false);
    for (const value of statuses.values()) {
      expect(typeof value).toBe("string");
    }
    expect(JSON.stringify([...statuses])).not.toContain(ADDRESS);
  });

  it("AC: an empty list gives an empty Map", async () => {
    const statuses = await getEmailStatuses([]);

    expect(statuses).toBeInstanceOf(Map);
    expect(statuses.size).toBe(0);
  });

  it.each([
    [
      "more than 1000 distinct keys",
      Array.from({ length: 1001 }, (_, i) => `k:${i}`),
    ],
    ["an empty-string key", ["batch:ok", ""]],
    ["a key of 201 characters", ["x".repeat(201)]],
    ["a list that is not an array", "batch:one"],
  ])("AC: %s is a ValidationError", async (_, keys) => {
    await expect(getEmailStatuses(keys)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("AC: duplicates count once, so 1000 distinct keys plus duplicates is allowed", async () => {
    await makeRow("batch:dup", "SENT");
    const distinct = Array.from({ length: 999 }, (_, i) => `k:${i}`);
    const keys = [
      ...distinct,
      "batch:dup",
      "batch:dup",
      ...distinct.slice(0, 5),
    ];

    const statuses = await getEmailStatuses(keys);

    expect(statuses.get("batch:dup")).toBe("SENT");
    expect(statuses.size).toBe(1);
  });
});
