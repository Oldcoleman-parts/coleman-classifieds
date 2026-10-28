import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing } from "@/../tests/factories.js";
import {
  transition,
  LISTING_EVENTS,
  InvalidTransitionError,
} from "@/modules/core/index.js";

const DAY = 24 * 60 * 60 * 1000;
const SELLER = { type: "SELLER" };
const MESSAGE = "SUBMIT isn't allowed: the deadline has passed";

describe("SUBMIT deadlines (AC: refused once the deadline has passed)", () => {
  beforeEach(() => resetDb());

  it.each([
    ["DRAFT", { draftDueBy: new Date(Date.now() - DAY) }],
    ["CHANGES_REQUESTED", { correctionDueBy: new Date(Date.now() - DAY) }],
  ])(
    "AC: SUBMIT from %s after its deadline throws and writes nothing",
    async (status, deadline) => {
      const listing = await makeListing({ status, ...deadline });

      await expect(
        transition(listing.id, LISTING_EVENTS.SUBMIT, SELLER),
      ).rejects.toThrow(new InvalidTransitionError(MESSAGE));

      const after = await prisma.listing.findUniqueOrThrow({
        where: { id: listing.id },
      });
      expect(after.status).toBe(status);
      expect(
        await prisma.auditEvent.count({ where: { listingId: listing.id } }),
      ).toBe(0);
    },
  );

  it("AC: a future deadline still refuses when the injected now is past it", async () => {
    const deadline = new Date(Date.now() + DAY);
    const listing = await makeListing({
      status: "DRAFT",
      draftDueBy: deadline,
    });

    await expect(
      transition(
        listing.id,
        LISTING_EVENTS.SUBMIT,
        SELLER,
        {},
        {
          now: new Date(deadline.getTime() + DAY),
        },
      ),
    ).rejects.toThrow(InvalidTransitionError);

    expect(
      (await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } }))
        .status,
    ).toBe("DRAFT");
  });
});
