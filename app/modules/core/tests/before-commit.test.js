import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing } from "@/../tests/factories.js";
import {
  transition,
  getSettings,
  subscribe,
  EVENTS,
  InvalidTransitionError,
  ValidationError,
} from "@/modules/core/index.js";

const DAY = 24 * 60 * 60 * 1000;
const SELLER = { type: "SELLER" };
const future = () => new Date(Date.now() + DAY);
const past = () => new Date(Date.now() - DAY);

const acceptance = (listing) => ({
  listingId: listing.id,
  kind: "LISTING_RULES",
  rulesVersion: "v-test",
  ip: "203.0.113.9",
  userAgent: "Test/1.0",
});

const statusOf = async (id) =>
  (await prisma.listing.findUniqueOrThrow({ where: { id } })).status;
const auditCount = (id) =>
  prisma.auditEvent.count({ where: { listingId: id } });

describe("transition() beforeCommit hook (AC: same transaction as SUBMIT)", () => {
  let unsubscribe = [];

  beforeEach(async () => {
    await resetDb();
    await getSettings();
  });

  afterEach(() => {
    unsubscribe.forEach((off) => off());
    unsubscribe = [];
  });

  it("AC: the hook gets tx and the SUBMITTED listing, and its write commits", async () => {
    const listing = await makeListing({
      status: "DRAFT",
      draftDueBy: future(),
    });
    const hook = vi.fn((tx, submitted) =>
      tx.termsAcceptance.create({ data: acceptance(submitted) }),
    );

    const after = await transition(
      listing.id,
      "SUBMIT",
      SELLER,
      {},
      {
        beforeCommit: hook,
      },
    );

    expect(hook).toHaveBeenCalledOnce();
    const [tx, submitted] = hook.mock.calls[0];
    expect(typeof tx.termsAcceptance.create).toBe("function");
    expect(submitted).toMatchObject({ id: listing.id, status: "SUBMITTED" });
    expect(after.status).toBe("SUBMITTED");
    expect(
      await prisma.termsAcceptance.count({ where: { listingId: listing.id } }),
    ).toBe(1);
  });

  it("AC: a throwing hook rolls back status and audit, rethrows, and sends no event", async () => {
    const listing = await makeListing({
      status: "DRAFT",
      draftDueBy: future(),
    });
    const handler = vi.fn();
    unsubscribe.push(subscribe(EVENTS.ListingSubmitted, handler));
    const failure = new Error("hook failed");

    await expect(
      transition(
        listing.id,
        "SUBMIT",
        SELLER,
        {},
        {
          beforeCommit: () => {
            throw failure;
          },
        },
      ),
    ).rejects.toBe(failure);

    expect(await statusOf(listing.id)).toBe("DRAFT");
    expect(await auditCount(listing.id)).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it("AC: a refused transition never calls the hook", async () => {
    const listing = await makeListing({ status: "DRAFT", draftDueBy: past() });
    const hook = vi.fn();

    await expect(
      transition(listing.id, "SUBMIT", SELLER, {}, { beforeCommit: hook }),
    ).rejects.toThrow(InvalidTransitionError);

    expect(hook).not.toHaveBeenCalled();
  });

  it("AC: a non-function beforeCommit is a ValidationError before any write", async () => {
    const listing = await makeListing({
      status: "DRAFT",
      draftDueBy: future(),
    });

    await expect(
      transition(listing.id, "SUBMIT", SELLER, {}, { beforeCommit: "nope" }),
    ).rejects.toThrow(ValidationError);

    expect(await statusOf(listing.id)).toBe("DRAFT");
    expect(await auditCount(listing.id)).toBe(0);
  });
});
