import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  runCorrectionExpiry,
  runDraftExpiry,
  runMonthExpiry,
} from "@/modules/ops/services/deadlines.js";
import {
  closedAudits,
  opsWorld,
  rowOf,
  seedListing,
  DAY_MS,
} from "./helpers.js";

const PAST = () => new Date(Date.now() - DAY_MS);
const FUTURE = () => new Date(Date.now() + 5 * DAY_MS);

describe("Deadline tasks (F08-T1)", () => {
  beforeAll(opsWorld);
  beforeEach(opsWorld);

  it("AC: each overdue deadline closes its listing on one run, and a second run changes nothing", async () => {
    const draft = await seedListing("DRAFT", { draftDueBy: PAST() });
    const correction = await seedListing("CHANGES_REQUESTED", {
      correctionDueBy: PAST(),
    });
    const live = await seedListing("LIVE", {
      liveAt: new Date(Date.now() - 40 * DAY_MS),
      expiresAt: PAST(),
    });

    const first = await Promise.all([
      runDraftExpiry(),
      runCorrectionExpiry(),
      runMonthExpiry(),
    ]);
    expect(first.map((summary) => summary.expired)).toEqual([1, 1, 1]);
    for (const { id } of [draft, correction, live])
      expect((await rowOf(id)).status).toBe("EXPIRED");

    const second = await Promise.all([
      runDraftExpiry(),
      runCorrectionExpiry(),
      runMonthExpiry(),
    ]);
    expect(second.map((summary) => summary.expired)).toEqual([0, 0, 0]);
    expect(await closedAudits(live.id)).toHaveLength(1);
  });

  it.each([
    ["DRAFT", { draftDueBy: FUTURE() }, runDraftExpiry],
    ["CHANGES_REQUESTED", { correctionDueBy: FUTURE() }, runCorrectionExpiry],
    ["LIVE", { expiresAt: FUTURE(), liveAt: PAST() }, runMonthExpiry],
  ])(
    "AC: a %s listing before its deadline is untouched",
    async (status, dates, run) => {
      const listing = await seedListing(status, dates);
      await run();
      expect((await rowOf(listing.id)).status).toBe(status);
    },
  );

  it("AC: a PAUSED listing past expiresAt is untouched", async () => {
    const listing = await seedListing("PAUSED", {
      liveAt: PAST(),
      expiresAt: PAST(),
    });
    await runMonthExpiry();
    expect((await rowOf(listing.id)).status).toBe("PAUSED");
  });

  it("AC: a LIVE listing with renewal on is untouched past expiresAt", async () => {
    const listing = await seedListing("LIVE", {
      liveAt: PAST(),
      expiresAt: PAST(),
      renewalOn: true,
    });
    await runMonthExpiry();
    expect((await rowOf(listing.id)).status).toBe("LIVE");
  });

  it("AC: with a small budget a task stops before the next listing, inside a page", async () => {
    const now = new Date();
    const listings = [];
    for (let i = 0; i < 3; i++) {
      listings.push(
        await seedListing("DRAFT", {
          draftDueBy: new Date(now.getTime() - (i + 1) * 60_000),
        }),
      );
    }
    // The page is fetched after one check; then one listing is handled; the next check stops.
    let checks = 0;
    const budget = { stopAt: 0, expired: () => ++checks > 2 };

    const summary = await runDraftExpiry({ now, budget });

    expect(summary).toEqual({ expired: 1, skipped: 0, errors: 0 });
    const statuses = await Promise.all(listings.map(({ id }) => rowOf(id)));
    expect(statuses.filter(({ status }) => status === "DRAFT")).toHaveLength(2);
  });
});
