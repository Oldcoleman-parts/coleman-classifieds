import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { clearAuditActionCache } from "@/modules/core/audit.js";
import { listAuditActions, writeAudit } from "@/modules/core";

// AC (F01-FIX-11): the action list has every action once, and is not re-read on each call.
const T0 = new Date("2026-03-01T00:00:00Z");
const ACTIONS = [
  "PaymentReceived",
  "ListingApproved",
  "ListingApproved",
  "privacy.customers_redact",
];

describe("listAuditActions", () => {
  let queryRaw;

  beforeAll(async () => {
    await resetDb();
    for (const [i, action] of ACTIONS.entries())
      await prisma.auditEvent.create({
        data: { id: `act${i}`, actor: "SYSTEM", action, at: T0 },
      });
  });

  // vi.spyOn would not survive restore on this client (the method is not an own property),
  // so the tagged-template method is swapped by hand and put back after each test.
  const realQueryRaw = prisma.$queryRaw;

  beforeEach(() => {
    clearAuditActionCache();
    queryRaw = vi.fn((...args) => realQueryRaw.apply(prisma, args));
    prisma.$queryRaw = queryRaw;
  });

  afterEach(() => {
    prisma.$queryRaw = realQueryRaw;
  });

  it("AC: returns each action once, sorted", async () => {
    const actions = await listAuditActions();
    expect(actions).toEqual([
      "ListingApproved",
      "PaymentReceived",
      "privacy.customers_redact",
    ]);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it("AC: a second call is served from the cache, one query in all", async () => {
    await listAuditActions();
    const first = queryRaw.mock.calls.length;
    await listAuditActions();
    expect(first).toBe(1);
    expect(queryRaw.mock.calls.length).toBe(1);
  });

  it("AC: after clearAuditActionCache() the list is read again", async () => {
    await listAuditActions();
    clearAuditActionCache();
    await listAuditActions();
    expect(queryRaw.mock.calls.length).toBe(2);
  });

  it("AC: a new action written by writeAudit shows in a warm cache without a query", async () => {
    await listAuditActions();
    const before = queryRaw.mock.calls.length;

    await writeAudit({ action: "TestNewAction", details: { note: "x" } });

    const actions = await listAuditActions();
    expect(actions).toContain("TestNewAction");
    expect(queryRaw.mock.calls.length).toBe(before);
  });
});
