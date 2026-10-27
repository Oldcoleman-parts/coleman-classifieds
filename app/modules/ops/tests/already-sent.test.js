// F08-FIX-5: reminder and closed-email batches leave out the listings already handled, before
// the contacts lookup and the budget, so a long run of sent rows can't starve the rest.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getSellerContacts } from "@/modules/access/index.js";
import { getSettings } from "@/modules/core/index.js";
import {
  runClosedEmails,
  closedEmailKey,
} from "@/modules/ops/services/closed-email.js";
import {
  reminderKeys,
  runDraftReminders,
} from "@/modules/ops/services/reminders.js";
import { breakSes, prisma } from "@/modules/payments/tests/helpers.js";
import { DAY_MS, opsWorld, seedListing } from "./helpers.js";

vi.mock("@/modules/access/index.js", async (orig) => {
  const real = await orig();
  return { ...real, getSellerContacts: vi.fn(real.getSellerContacts) };
});

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
// Seeding 250 listings takes a while on the shared test database (as batches.test.js does).
const SLOW_MS = 120_000;

describe("Batches leave out what is already handled (F08-FIX-5)", () => {
  let ses;
  let days;
  beforeEach(async () => {
    ({ ses } = await opsWorld());
    ({ draftReminderDaysBefore: days } = await getSettings());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keys: reminderKeys and closedEmailKey give the exact key strings", () => {
    const deadline = new Date(1_000);
    expect(reminderKeys("draft_reminder", "L1", deadline)).toEqual([
      "draft_reminder:L1:1000:0",
      "draft_reminder:L1:1000:1",
      "draft_reminder:L1:1000:2",
    ]);
    expect(closedEmailKey("L1", new Date(2_000))).toBe(
      "listing_closed:L1:2000",
    );
  });

  it(
    "AC: with 250 draft listings in the window where the nearest 200 were already reminded, one run with a budget for a few sends reminds the later ones",
    async () => {
      const now = new Date();
      const windowEnd = now.getTime() + days * DAY_MS;
      for (let i = 0; i < 200; i++) {
        await seedListing("DRAFT", {
          draftDueBy: new Date(windowEnd - (250 - i) * MINUTE_MS),
        });
      }
      const first = await runDraftReminders({ now });
      expect(first.alreadySent).toBe(0);
      expect(ses.send).toHaveBeenCalledTimes(200);

      const later = new Set();
      for (let i = 0; i < 50; i++) {
        const listing = await seedListing("DRAFT", {
          draftDueBy: new Date(windowEnd - (50 - i) * MINUTE_MS),
        });
        later.add(listing.id);
      }
      ses.send.mockClear();

      const budget = {
        stopAt: 0,
        expired: () => ses.send.mock.calls.length >= 5,
      };
      const summary = await runDraftReminders({ now, budget });

      expect(summary).toMatchObject({ due: 5, alreadySent: 200 });
      expect(ses.send).toHaveBeenCalledTimes(5);
      const rows = await prisma.emailOutbox.findMany({
        where: { templateKey: "draft_reminder", status: "SENT" },
        select: { idempotencyKey: true },
      });
      const reminded = rows
        .map(({ idempotencyKey }) => idempotencyKey.split(":")[1])
        .filter((id) => later.has(id));
      expect(reminded).toHaveLength(5);
    },
    SLOW_MS,
  );

  it("AC: a listing whose reminder tries all failed is not tried again in a later run", async () => {
    const now = new Date();
    await seedListing("DRAFT", {
      draftDueBy: new Date(now.getTime() + days * DAY_MS),
    });
    breakSes(ses);
    await runDraftReminders({ now });
    await runDraftReminders({ now: new Date(now.getTime() + HOUR_MS) });
    await runDraftReminders({ now: new Date(now.getTime() + 2 * HOUR_MS) });
    const failedRows = await prisma.emailOutbox.count({
      where: { templateKey: "draft_reminder", status: "FAILED" },
    });
    expect(failedRows).toBe(3);

    ses.send.mockImplementation(async (command) => {
      ses.sent.push(command);
      return { MessageId: "restored" };
    });
    ses.send.mockClear();
    const summary = await runDraftReminders({
      now: new Date(now.getTime() + 3 * HOUR_MS),
    });

    expect(ses.send).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ alreadySent: 1, due: 0 });
  });

  it("AC: a listing with a failed try and tries left is tried again", async () => {
    const now = new Date();
    const listing = await seedListing("DRAFT", {
      draftDueBy: new Date(now.getTime() + days * DAY_MS),
    });
    breakSes(ses);
    await runDraftReminders({ now });

    ses.send.mockImplementation(async (command) => {
      ses.sent.push(command);
      return { MessageId: "retry-ok" };
    });
    const summary = await runDraftReminders({
      now: new Date(now.getTime() + HOUR_MS),
    });

    expect(summary).toMatchObject({ alreadySent: 0, due: 1 });
    const [key] = reminderKeys(
      "draft_reminder",
      listing.id,
      listing.draftDueBy,
    ).slice(1, 2);
    const row = await prisma.emailOutbox.findUnique({
      where: { idempotencyKey: key },
    });
    expect(row?.status).toBe("SENT");
  });

  it("AC: a closed email is not looked up or sent again by a later backstop run", async () => {
    const now = new Date();
    const closedAt = new Date(now.getTime() - HOUR_MS);
    for (const n of [1, 2]) {
      await seedListing("SOLD", {
        closedAt,
        closedReason: "SOLD",
        metaobjectGid: `gid://shopify/Metaobject/3${n}`,
        metaobjectHandle: `lantern-3${n}`,
      });
    }

    const first = await runClosedEmails({ now });
    expect(first.checked).toBe(2);
    vi.mocked(getSellerContacts).mockClear();

    const second = await runClosedEmails({ now });

    expect(second).toEqual({ checked: 0, errors: 0, alreadySent: 2 });
    expect(getSellerContacts).not.toHaveBeenCalled();
    const rows = await prisma.emailOutbox.count({
      where: { templateKey: "listing_closed" },
    });
    expect(rows).toBe(2);
  });
});
