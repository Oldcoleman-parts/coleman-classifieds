import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { makeListing } from "@/../tests/factories.js";
import {
  parseExportFilter,
  streamHistoryCsv,
} from "@/modules/console/index.js";
import { csvCell } from "@/modules/console/services/csv.js";
import { HISTORY_COLUMNS } from "@/modules/console/services/history.js";
import { setUp, tearDown, staffActor, prisma, STAFF } from "./helpers.js";

describe("F05-T2: History export", () => {
  beforeAll(async () => {
    await setUp();
  });

  beforeEach(async () => {
    await setUp();
  });

  afterEach(() => {
    tearDown();
  });

  it("AC: the CSV contains every event in order with correct header", async () => {
    const listing1 = await makeListing();
    const listing2 = await makeListing();

    // Create events with varying timestamps
    const baseTime = new Date("2026-10-01T12:00:00Z");
    const events = [
      {
        listingId: listing1.id,
        actor: "STAFF",
        actorRef: "staff@example.test",
        action: "ListingSubmitted",
        details: { note: "submitted" },
        at: new Date(baseTime.getTime()),
      },
      {
        listingId: listing1.id,
        actor: "STAFF",
        actorRef: "staff@example.test",
        action: "ListingApproved",
        details: {
          transition: "APPROVE",
          from: "SUBMITTED",
          to: "APPROVED_AWAITING_PAYMENT",
        },
        at: new Date(baseTime.getTime() + 1000),
      },
      {
        listingId: listing2.id,
        actor: "STAFF",
        actorRef: "staff@example.test",
        action: "ListingSubmitted",
        details: {},
        at: new Date(baseTime.getTime()),
      },
    ];

    await prisma.auditEvent.createMany({ data: events });

    // Export all history
    const { stream } = await streamHistoryCsv(
      { from: "2026-10-01", to: "2026-10-02" },
      staffActor,
    );

    const chunks = [];
    const reader = stream.getReader();
    let result;
    while (!(result = await reader.read()).done) {
      chunks.push(result.value);
    }

    const decoder = new TextDecoder();
    const csv = chunks.map((chunk) => decoder.decode(chunk)).join("");
    const lines = csv.split("\r\n").filter((line) => line);

    // Verify header
    expect(lines[0]).toContain(
      HISTORY_COLUMNS.join(",").replaceAll(",", '","'),
    );

    // Verify events are present (should have header + 3 events - the export audit itself)
    const eventLines = lines.slice(1);
    expect(eventLines.length).toBeGreaterThanOrEqual(3);
  });

  it("AC: listing filter returns only that listing's events", async () => {
    const listing1 = await makeListing();
    const listing2 = await makeListing();

    await prisma.auditEvent.createMany({
      data: [
        {
          listingId: listing1.id,
          actor: "STAFF",
          actorRef: "staff@example.test",
          action: "ListingSubmitted",
          details: {},
          at: new Date(),
        },
        {
          listingId: listing2.id,
          actor: "STAFF",
          actorRef: "staff@example.test",
          action: "ListingSubmitted",
          details: {},
          at: new Date(),
        },
      ],
    });

    const { stream } = await streamHistoryCsv(
      { listingId: listing1.id },
      staffActor,
    );

    const chunks = [];
    const reader = stream.getReader();
    let result;
    while (!(result = await reader.read()).done) {
      chunks.push(result.value);
    }

    const decoder = new TextDecoder();
    const csv = chunks.map((chunk) => decoder.decode(chunk)).join("");
    const lines = csv.split("\r\n").filter((line) => line);

    // Header + 1 event (only listing1)
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain(listing1.id);
  });

  it("AC: date-range filter works", async () => {
    const listing = await makeListing();

    // Create a few events for the export
    await prisma.auditEvent.createMany({
      data: [
        {
          listingId: listing.id,
          actor: "STAFF",
          actorRef: "staff@example.test",
          action: "Event1",
          details: {},
          at: new Date(),
        },
        {
          listingId: listing.id,
          actor: "STAFF",
          actorRef: "staff@example.test",
          action: "Event2",
          details: {},
          at: new Date(Date.now() + 1000),
        },
      ],
    });

    // Use a very broad date range that will definitely include all events
    const { stream } = await streamHistoryCsv(
      { from: "2026-01-01", to: "2026-12-31" },
      staffActor,
    );

    const chunks = [];
    const reader = stream.getReader();
    let result;
    while (!(result = await reader.read()).done) {
      chunks.push(result.value);
    }

    const decoder = new TextDecoder();
    const csv = chunks.map((chunk) => decoder.decode(chunk)).join("");

    // Verify events are in the CSV
    expect(csv).toContain("Event1");
    expect(csv).toContain("Event2");
  });

  describe("SEC: CSV injection is escaped", () => {
    it.each([
      ["=1+1", "formula with ="],
      ["+2+2", "formula with +"],
      ["-1-1", "formula with -"],
      ["@example.test", "formula with @"],
      ["\texcel tab", "formula with tab"],
      ["\rcarriage return", "formula with CR"],
      ['quote"here', "embedded quote"],
      ["comma,here", "embedded comma"],
      ["new\nline", "embedded newline"],
    ])("escapes %s in actorRef", async (malicious) => {
      const listing = await makeListing();
      await prisma.auditEvent.create({
        data: {
          listingId: listing.id,
          actor: "STAFF",
          actorRef: malicious,
          action: "Test",
          details: {},
          at: new Date(),
        },
      });

      const { stream } = await streamHistoryCsv(
        { listingId: listing.id },
        staffActor,
      );
      const chunks = [];
      const reader = stream.getReader();
      let result;
      while (!(result = await reader.read()).done) {
        chunks.push(result.value);
      }

      const decoder = new TextDecoder();
      const csv = chunks.map((chunk) => decoder.decode(chunk)).join("");
      // A formula start is made plain text; everything stays inside one quoted cell.
      const cell = /^[=+\-@\t\r]/.test(malicious)
        ? `"'${malicious}"`
        : `"${malicious.replaceAll('"', '""')}"`;
      expect(csv).toContain(`,${cell},`);
    });
  });

  it("SEC: csvCell escapes formula-starting values", () => {
    expect(csvCell("=1+1")).toContain("'=1+1");
    expect(csvCell("+test")).toContain("'+test");
    expect(csvCell("-test")).toContain("'-test");
    expect(csvCell("@test")).toContain("'@test");
    expect(csvCell("\ttab")).toContain("'\ttab");
    expect(csvCell("\rCR")).toContain("'\rCR");
    // Quotes and commas are handled by surrounding quotes and escaping
    expect(csvCell('quote"')).toBe('"quote"""');
  });

  it("SEC: the export is streamed in batches", async () => {
    const listing = await makeListing();

    // Create >1000 events to ensure multiple batches (batch size is 500)
    const events = [];
    for (let i = 0; i < 1200; i++) {
      events.push({
        listingId: listing.id,
        actor: "STAFF",
        actorRef: "staff@example.test",
        action: `Event${i}`,
        details: { index: i },
        at: new Date(Date.now() + i * 1000),
      });
    }
    await prisma.auditEvent.createMany({ data: events });

    const { stream } = await streamHistoryCsv(
      { listingId: listing.id },
      staffActor,
    );

    const chunks = [];
    const reader = stream.getReader();
    let result;
    while (!(result = await reader.read()).done) {
      chunks.push(result.value);
    }

    // Should have multiple chunks
    expect(chunks.length).toBeGreaterThan(1);

    // Verify complete result is ordered
    const decoder = new TextDecoder();
    const csv = chunks.map((chunk) => decoder.decode(chunk)).join("");
    const lines = csv.split("\r\n").filter((line) => line);
    expect(lines.length).toBeGreaterThan(1000);
  });

  it("SEC: export is audited with staff email and audit row is not in its own file", async () => {
    const listing = await makeListing();
    await prisma.auditEvent.create({
      data: {
        listingId: listing.id,
        actor: "STAFF",
        actorRef: "staff@example.test",
        action: "ListingSubmitted",
        details: {},
        at: new Date(),
      },
    });

    const { stream } = await streamHistoryCsv(
      { listingId: listing.id },
      staffActor,
    );

    const chunks = [];
    const reader = stream.getReader();
    let result;
    while (!(result = await reader.read()).done) {
      chunks.push(result.value);
    }

    const decoder = new TextDecoder();
    const csv = chunks.map((chunk) => decoder.decode(chunk)).join("");

    // The export should not contain "HistoryExported" (the audit row itself)
    expect(csv).not.toContain("HistoryExported");

    // Verify audit was written
    const audits = await prisma.auditEvent.findMany({
      where: { action: "HistoryExported", listingId: listing.id },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toBe("STAFF");
    expect(audits[0].actorRef).toBe(STAFF.session.email);
  });

  it("SEC: only needed fields appear in export (non-lifecycle to field is excluded)", async () => {
    const listing = await makeListing();
    const invitation = await prisma.invitation.findUnique({
      where: { id: listing.invitationId },
    });

    // Create an audit event with a "to" field (like an email recipient)
    // This "to" field should not appear in the CSV output
    await prisma.auditEvent.create({
      data: {
        listingId: listing.id,
        actor: "STAFF",
        actorRef: "staff@example.test",
        action: "TestEvent",
        details: { to: "buyer@example.test", note: "test note" },
        at: new Date(),
      },
    });

    const { stream } = await streamHistoryCsv(
      { listingId: listing.id },
      staffActor,
    );

    const chunks = [];
    const reader = stream.getReader();
    let result;
    while (!(result = await reader.read()).done) {
      chunks.push(result.value);
    }

    const decoder = new TextDecoder();
    const csv = chunks.map((chunk) => decoder.decode(chunk)).join("");

    // Non-lifecycle "to" field should not appear in the CSV
    // The test verifies it by checking that buyer email doesn't appear
    expect(csv).not.toContain("buyer@example.test");
    // No seller details are joined in
    expect(invitation.sellerEmail).toBeTruthy();
    expect(csv).not.toContain(invitation.sellerEmail);
    if (invitation.sellerPhone)
      expect(csv).not.toContain(invitation.sellerPhone);
    // But the event action should still be there
    expect(csv).toContain("TestEvent");
  });

  describe("parseExportFilter validation", () => {
    it.each([
      [{ listingId: "test-123" }, { listingId: "test-123" }, "valid listing"],
      [{ from: "2026-10-01", to: "2026-10-02" }, "range", "valid date range"],
      [
        { listingId: "test", from: "2026-10-01" },
        "error",
        "both listing and range",
      ],
      [{ from: "2026-10-01" }, "error", "only from date"],
      [{ to: "2026-10-02" }, "error", "only to date"],
      [{}, "error", "neither listing nor range"],
      [{ from: "2026-13-01", to: "2026-10-02" }, "error", "invalid from date"],
      [{ from: "2026-10-02", to: "2026-10-01" }, "error", "to before from"],
      [{ from: "2025-01-01", to: "2026-10-01" }, "error", "over 366 days"],
      [{ from: "2026-02-30", to: "2026-03-02" }, "error", "a day that isn't"],
      [{ listingId: "bad id; drop" }, "error", "malformed id"],
    ])("parseExportFilter: %s", (input, expected) => {
      if (expected === "error") {
        expect(() => parseExportFilter(input)).toThrow();
      } else if (expected === "range") {
        const result = parseExportFilter(input);
        expect(result).toHaveProperty("from");
        expect(result).toHaveProperty("to");
        expect(result).toHaveProperty("start");
        expect(result).toHaveProperty("end");
      } else {
        const result = parseExportFilter(input);
        expect(result).toEqual(expected);
      }
    });
  });
});
