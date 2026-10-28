import { describe, it, expect, beforeEach } from "vitest";
import {
  runRenewalGrace,
  runRenewalReminders,
  runUnverifiedSubmissions,
} from "@/modules/ops/services/hooks.js";
import { DAY_MS, opsWorld, rowOf, seedListing } from "./helpers.js";

describe("Phase 2 and Later task hooks (F08-T1)", () => {
  beforeEach(async () => {
    await opsWorld();
  });

  it.each([
    ["renewals.grace-expiry", runRenewalGrace],
    ["renewals.reminders", runRenewalReminders],
    ["open-submissions.unverified", runUnverifiedSubmissions],
  ])("AC: %s returns flag-off while its flag is off", async (_task, run) => {
    expect(await run()).toEqual({ skipped: "flag-off" });
  });

  it("AC: with the flags off, a renewal grace listing past its grace period is untouched", async () => {
    const listing = await seedListing("PAYMENT_OVERDUE", {
      liveAt: new Date(Date.now() - 40 * DAY_MS),
      expiresAt: new Date(Date.now() - DAY_MS),
      overdueSince: new Date(Date.now() - 30 * DAY_MS),
    });
    await runRenewalGrace();
    expect((await rowOf(listing.id)).status).toBe("PAYMENT_OVERDUE");
  });
});
