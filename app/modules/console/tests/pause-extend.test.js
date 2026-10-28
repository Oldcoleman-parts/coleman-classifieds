import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { makeListing } from "@/../tests/factories.js";
import { handleReviewAction } from "@/modules/console/index.js";
import {
  setUp,
  tearDown,
  staffActor,
  prisma,
  expectAuditedByStaff,
} from "./helpers.js";

describe("F05-T1: Pause, resume, extend", () => {
  beforeAll(async () => {
    await setUp();
  });

  beforeEach(async () => {
    await setUp();
  });

  afterEach(() => {
    vi.useRealTimers();
    tearDown();
  });

  it("AC: ORDINARY pause keeps expiresAt unchanged", async () => {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const listing = await makeListing({ status: "LIVE", expiresAt });

    const form = new FormData();
    form.set("intent", "pause");
    form.set("reason", "ORDINARY");

    const result = await handleReviewAction(listing.id, form, {
      actor: staffActor,
    });

    expect(result.ok).toBe(true);

    const updated = await prisma.listing.findUnique({
      where: { id: listing.id },
    });
    expect(updated.status).toBe("PAUSED");
    expect(updated.expiresAt.getTime()).toBe(expiresAt.getTime());

    // No time adjustment rows
    const adjustments = await prisma.listingTimeAdjustment.findMany({
      where: { listingId: listing.id },
    });
    expect(adjustments).toHaveLength(0);
  });

  it("AC: INVESTIGATION pause, advance 90 minutes, resume with violation=no restores time", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-06T12:00:00Z");
    vi.setSystemTime(now);

    const expiresAt = new Date("2026-11-06T12:00:00Z");
    const listing = await makeListing({ status: "LIVE", expiresAt });

    // Pause with INVESTIGATION reason
    const form1 = new FormData();
    form1.set("intent", "pause");
    form1.set("reason", "INVESTIGATION");

    const result1 = await handleReviewAction(listing.id, form1, {
      actor: staffActor,
    });
    expect(result1.ok).toBe(true);

    // Advance 90 minutes
    vi.setSystemTime(new Date(now.getTime() + 90 * 60 * 1000));

    // Resume with violation=no
    const form2 = new FormData();
    form2.set("intent", "resume");
    form2.set("violation", "no");

    const result2 = await handleReviewAction(listing.id, form2, {
      actor: staffActor,
    });
    expect(result2.ok).toBe(true);

    const updated = await prisma.listing.findUnique({
      where: { id: listing.id },
    });
    expect(updated.status).toBe("LIVE");

    // expiresAt should be 90 minutes later than original
    const expected = new Date(expiresAt.getTime() + 90 * 60 * 1000);
    expect(updated.expiresAt.getTime()).toBe(expected.getTime());

    // One INVESTIGATION_RESTORE adjustment with 90 minutes
    const adjustments = await prisma.listingTimeAdjustment.findMany({
      where: { listingId: listing.id },
    });
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].type).toBe("INVESTIGATION_RESTORE");
    expect(adjustments[0].minutes).toBe(90);
  });

  it("AC: INVESTIGATION pause, resume with violation=yes keeps expiresAt unchanged", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-06T12:00:00Z");
    vi.setSystemTime(now);

    const expiresAt = new Date("2026-11-06T12:00:00Z");
    const listing = await makeListing({ status: "LIVE", expiresAt });

    // Pause with INVESTIGATION
    const form1 = new FormData();
    form1.set("intent", "pause");
    form1.set("reason", "INVESTIGATION");

    await handleReviewAction(listing.id, form1, { actor: staffActor });

    // Advance time
    vi.setSystemTime(new Date(now.getTime() + 90 * 60 * 1000));

    // Resume with violation=yes
    const form2 = new FormData();
    form2.set("intent", "resume");
    form2.set("violation", "yes");

    const result2 = await handleReviewAction(listing.id, form2, {
      actor: staffActor,
    });
    expect(result2.ok).toBe(true);

    const updated = await prisma.listing.findUnique({
      where: { id: listing.id },
    });
    expect(updated.expiresAt.getTime()).toBe(expiresAt.getTime());

    // No adjustments
    const adjustments = await prisma.listingTimeAdjustment.findMany({
      where: { listingId: listing.id },
    });
    expect(adjustments).toHaveLength(0);
  });

  it("AC: Resume of ORDINARY listing without violation fails", async () => {
    const listing = await makeListing({
      status: "PAUSED",
      pauseReason: "ORDINARY",
    });

    const form = new FormData();
    form.set("intent", "resume");
    form.set("violation", "no"); // Should be ignored

    const result = await handleReviewAction(listing.id, form, {
      actor: staffActor,
    });

    expect(result.ok).toBe(true);
    const updated = await prisma.listing.findUnique({
      where: { id: listing.id },
    });
    expect(updated.status).toBe("LIVE");
  });

  it("AC: Extend adds days as minutes and records reason", async () => {
    const expiresAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const listing = await makeListing({ status: "LIVE", expiresAt });

    const form = new FormData();
    form.set("intent", "extend");
    form.set("days", "3");
    form.set("reason", "Site outage");

    const result = await handleReviewAction(listing.id, form, {
      actor: staffActor,
    });

    expect(result.ok).toBe(true);

    const updated = await prisma.listing.findUnique({
      where: { id: listing.id },
    });

    // 3 days = 4320 minutes
    const expected = new Date(expiresAt.getTime() + 3 * 24 * 60 * 60 * 1000);
    expect(updated.expiresAt.getTime()).toBe(expected.getTime());

    // One TECHNICAL_EXTENSION with 4320 minutes
    const adjustments = await prisma.listingTimeAdjustment.findMany({
      where: { listingId: listing.id },
    });
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].type).toBe("TECHNICAL_EXTENSION");
    expect(adjustments[0].minutes).toBe(4320);
    expect(adjustments[0].reason).toBe("Site outage");
    await expectAuditedByStaff(listing.id, "ListingExtended");
  });

  it("AC: Extend fails without reason", async () => {
    const listing = await makeListing({ status: "LIVE" });

    const form = new FormData();
    form.set("intent", "extend");
    form.set("days", "3");
    form.set("reason", "");

    const result = await handleReviewAction(listing.id, form, {
      actor: staffActor,
    });

    expect(result.ok).toBe(false);
    expect(result.fieldErrors.reason).toBeDefined();
  });

  it("AC: Extend fails with days=0 or >60", async () => {
    const listing = await makeListing({ status: "LIVE" });

    // days=0
    const form1 = new FormData();
    form1.set("intent", "extend");
    form1.set("days", "0");
    form1.set("reason", "test");

    const result1 = await handleReviewAction(listing.id, form1, {
      actor: staffActor,
    });
    expect(result1.ok).toBe(false);

    // days=61
    const form2 = new FormData();
    form2.set("intent", "extend");
    form2.set("days", "61");
    form2.set("reason", "test");

    const result2 = await handleReviewAction(listing.id, form2, {
      actor: staffActor,
    });
    expect(result2.ok).toBe(false);
  });

  it("AC: Pause, resume audit with staff email", async () => {
    const listing = await makeListing({ status: "LIVE" });

    const form1 = new FormData();
    form1.set("intent", "pause");
    form1.set("reason", "ORDINARY");

    await handleReviewAction(listing.id, form1, { actor: staffActor });

    const form2 = new FormData();
    form2.set("intent", "resume");

    await handleReviewAction(listing.id, form2, { actor: staffActor });

    const audits = await prisma.auditEvent.findMany({
      where: { listingId: listing.id },
      orderBy: { at: "asc" },
    });

    const pauseAudit = audits.find((a) => a.details.transition === "PAUSE");
    const resumeAudit = audits.find((a) => a.details.transition === "RESUME");

    expect(pauseAudit.actorRef).toBe(staffActor.ref);
    expect(resumeAudit.actorRef).toBe(staffActor.ref);
  });
});
