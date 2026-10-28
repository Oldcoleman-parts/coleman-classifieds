// F08-FIX-6: findPagesToRetire reads the candidates in chunks of 500. With 501 candidates, the
// listing at position 501 (second chunk) is still held, and `due` stays oldest close first.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  findPagesToRetire,
  RETIRE_FAILED,
} from "@/modules/ops/services/facts.js";
import { resetDb } from "@/../tests/db.js";
import { DAY_MS, opsWorld, prisma, RETIRE_FAILURES } from "./helpers.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const CANDIDATES = 501;
const TAKE = 5;
/** Index 500 is position 501 in oldest-close order: the first id of the second chunk. */
const LAST = CANDIDATES - 1;

/** @type {string[]} candidate ids, oldest close first */
let ids;
/** @type {Date} */
let now;
/** @type {Date} */
let cutoff;

/** Seeds 501 closed SOLD listings with a page, past the cutoff, and 3 recent failures on the last. */
async function seedCandidates() {
  ids = Array.from({ length: CANDIDATES }, (_, i) => `retire-chunk-${i}`);
  await prisma.invitation.createMany({
    data: ids.map((id, i) => ({
      id,
      tokenHash: `retire-chunk-token-${i}`,
      sellerName: "Sam Seller",
      sellerEmail: `retire-chunk-${i}@example.test`,
      itemSummary: "Coleman 200A lantern",
      feeRegularCents: 3000,
      feeOfferedCents: 3000,
      expiresAt: new Date(now.getTime() + 30 * DAY_MS),
    })),
  });
  await prisma.listing.createMany({
    data: ids.map((id, i) => ({
      id,
      invitationId: id,
      status: "SOLD",
      title: "1962 Coleman 200A lantern",
      arrangements: [],
      renewalOn: false,
      // i = 0 closed longest ago, so it comes first in the batch.
      closedAt: new Date(cutoff.getTime() - (CANDIDATES - i) * MINUTE_MS),
      closedReason: "SOLD",
      metaobjectGid: `gid://shopify/Metaobject/${1000 + i}`,
      metaobjectHandle: `retire-chunk-${i}`,
    })),
  });
  await prisma.auditEvent.createMany({
    data: Array.from({ length: RETIRE_FAILURES }, () => ({
      listingId: ids[LAST],
      actor: "SYSTEM",
      action: RETIRE_FAILED,
      details: { code: "INTERNAL_ERROR" },
      at: new Date(now.getTime() - HOUR_MS),
    })),
  });
}

/** @returns {ReturnType<typeof findPagesToRetire>} */
const run = () =>
  findPagesToRetire(cutoff, TAKE, {
    maxFailures: RETIRE_FAILURES,
    windowDays: 7,
    now,
  });

describe("Page retirement candidates past one chunk (F08-FIX-6)", () => {
  beforeEach(async () => {
    await opsWorld();
    now = new Date();
    cutoff = new Date(now.getTime() - 90 * DAY_MS);
    await seedCandidates();
  });
  // AuditEvent is append-only (triggers reject UPDATE, DELETE and TRUNCATE), so the seeded
  // audit rows can only go through resetDb(), which switches the triggers off for its transaction.
  afterAll(async () => {
    await resetDb();
  });

  it("AC: the listing at position 501 with 3 recent failures is in held and newlyHeld with failures 3", async () => {
    const result = await run();

    expect(result.held).toEqual([ids[LAST]]);
    expect(result.newlyHeld).toEqual([
      { id: ids[LAST], failures: RETIRE_FAILURES },
    ]);
  });

  it("AC: the listing at position 501 is not in due", async () => {
    const result = await run();

    expect(result.due.map(({ id }) => id)).not.toContain(ids[LAST]);
  });

  it("AC: due has `take` entries, oldest close first", async () => {
    const result = await run();

    expect(result.due.map(({ id }) => id)).toEqual(ids.slice(0, TAKE));
  });
});
