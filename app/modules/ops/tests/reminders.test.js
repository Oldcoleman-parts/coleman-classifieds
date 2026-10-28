import { describe, it, expect, beforeEach } from "vitest";
import { getLinkUrl } from "@/modules/access/index.js";
import { getSettings } from "@/modules/core/index.js";
import {
  runDraftReminders,
  runExpiryReminders,
} from "@/modules/ops/services/reminders.js";
import { breakSes, emailText, SHOP } from "@/modules/payments/tests/helpers.js";
import { DAY_MS, opsWorld, prisma, seedListing } from "./helpers.js";

const HOUR_MS = 60 * 60 * 1000;

describe("Reminder tasks (F08-T1)", () => {
  let ses;
  let shopify;
  let days;
  beforeEach(async () => {
    ({ ses, shopify } = await opsWorld());
    const settings = await getSettings();
    days = {
      draft: settings.draftReminderDaysBefore,
      expiry: settings.expiryReminderDays,
    };
  });

  // The window opens exactly `days` before the deadline, so run 1 is try 0 of the window.
  const dueIn = (now, n) => new Date(now.getTime() + n * DAY_MS);

  it("AC: a draft reminder is sent once across two runs", async () => {
    const now = new Date();
    await seedListing("DRAFT", { draftDueBy: dueIn(now, days.draft) });
    await runDraftReminders({ now });
    await runDraftReminders({ now });
    expect(ses.send).toHaveBeenCalledTimes(1);
  });

  it("AC: an expiry reminder is sent once across two runs", async () => {
    const now = new Date();
    await seedListing("LIVE", {
      liveAt: new Date(now.getTime() - DAY_MS),
      expiresAt: dueIn(now, days.expiry),
    });
    await runExpiryReminders({ now });
    await runExpiryReminders({ now });
    expect(ses.send).toHaveBeenCalledTimes(1);
  });

  it("AC: a failed reminder is retried on a later run with the next try key", async () => {
    const now = new Date();
    const listing = await seedListing("DRAFT", {
      draftDueBy: dueIn(now, days.draft),
    });
    breakSes(ses);
    const failed = await runDraftReminders({ now });
    expect(failed.failed).toBe(1);

    ses.send.mockImplementation(async (command) => {
      ses.sent.push(command);
      return { MessageId: "retry-ok" };
    });
    await runDraftReminders({ now: new Date(now.getTime() + HOUR_MS) });

    expect(ses.sent).toHaveLength(1);
    const key = `draft_reminder:${listing.id}:${listing.draftDueBy.getTime()}:1`;
    const row = await prisma.emailOutbox.findUnique({
      where: { idempotencyKey: key },
    });
    expect(row?.status).toBe("SENT");
  });

  it("AC: a reminder links Get my link and never the private seller link", async () => {
    const now = new Date();
    await seedListing("DRAFT", { draftDueBy: dueIn(now, days.draft) });
    await runDraftReminders({ now });
    const text = emailText(ses);
    expect(text).toContain(await getLinkUrl(shopify.admin, SHOP));
    expect(text).not.toContain("/apps/classifieds/seller/");
  });

  it("AC: listings outside the reminder window get nothing", async () => {
    const now = new Date();
    await seedListing("DRAFT", { draftDueBy: dueIn(now, days.draft + 5) });
    await seedListing("LIVE", {
      liveAt: now,
      expiresAt: dueIn(now, days.expiry + 5),
    });
    const draft = await runDraftReminders({ now });
    const expiry = await runExpiryReminders({ now });
    expect(draft.due).toBe(0);
    expect(expiry.due).toBe(0);
    expect(ses.send).not.toHaveBeenCalled();
  });
});
