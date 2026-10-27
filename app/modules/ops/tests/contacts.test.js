// Seller contacts come from access.getSellerContacts() (F08-FIX-3): one lookup per batch, and a
// listing with no contact is skipped and logged by id only.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getSellerContacts } from "@/modules/access/index.js";
import { getSettings } from "@/modules/core/index.js";
import { runDraftReminders } from "@/modules/ops/services/reminders.js";
import { runClosedEmails } from "@/modules/ops/services/closed-email.js";
import { closedEmails, DAY_MS, opsWorld, seedListing } from "./helpers.js";

vi.mock("@/modules/access/index.js", async (orig) => {
  const real = await orig();
  return { ...real, getSellerContacts: vi.fn(real.getSellerContacts) };
});

describe("ops reads seller contacts through access (F08-FIX-3)", () => {
  let ses;
  let days;
  let warn;

  beforeEach(async () => {
    ({ ses } = await opsWorld());
    const settings = await getSettings();
    days = { draft: settings.draftReminderDaysBefore };
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  // Everything logged, joined, so a test can check what did and did not leak.
  const logged = () => warn.mock.calls.flat().join("\n");

  it("AC: a draft reminder for a listing with no contact is skipped and logged by id only", async () => {
    const now = new Date();
    const listing = await seedListing("DRAFT", {
      draftDueBy: new Date(now.getTime() + days.draft * DAY_MS),
    });
    vi.mocked(getSellerContacts).mockResolvedValueOnce(new Map());

    const summary = await runDraftReminders({ now });

    expect(summary.failed).toBe(1);
    expect(ses.send).not.toHaveBeenCalled();
    expect(logged()).toContain(listing.id);
    expect(logged()).not.toContain(listing.invitation.sellerEmail);
    expect(logged()).not.toContain(listing.invitation.sellerName);
  });

  it("AC: runClosedEmails looks up contacts once per batch", async () => {
    const closedAt = new Date(Date.now() - DAY_MS / 24);
    await seedListing("SOLD", {
      closedAt,
      closedReason: "SOLD",
      metaobjectGid: "gid://shopify/Metaobject/21",
      metaobjectHandle: "lantern-21",
    });
    await seedListing("SOLD", {
      closedAt,
      closedReason: "SOLD",
      metaobjectGid: "gid://shopify/Metaobject/22",
      metaobjectHandle: "lantern-22",
    });
    // Listeners may have looked up contacts already; count only the batch call.
    vi.mocked(getSellerContacts).mockClear();

    const summary = await runClosedEmails();

    expect(summary.checked).toBe(2);
    expect(getSellerContacts).toHaveBeenCalledTimes(1);
    const [ids] = vi.mocked(getSellerContacts).mock.calls[0];
    expect(ids).toHaveLength(2);
    expect(await closedEmails()).toHaveLength(2);
  });

  it("the closed-email backstop skips a listing with no contact", async () => {
    const listing = await seedListing("SOLD", {
      closedAt: new Date(Date.now() - DAY_MS / 24),
      closedReason: "SOLD",
      metaobjectGid: "gid://shopify/Metaobject/23",
      metaobjectHandle: "lantern-23",
    });
    vi.mocked(getSellerContacts).mockResolvedValueOnce(new Map());

    const summary = await runClosedEmails();

    expect(summary.errors).toBe(1);
    expect(await closedEmails()).toHaveLength(0);
    expect(logged()).toContain(listing.id);
    expect(logged()).not.toContain(listing.invitation.sellerEmail);
    expect(logged()).not.toContain(listing.invitation.sellerName);
  });
});
