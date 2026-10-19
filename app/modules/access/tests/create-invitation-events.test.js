import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { asStaff } from "@/../tests/factories.js";
import { createInvitation } from "@/modules/access/index.js";
import {
  EVENTS,
  resetEventBus,
  staffFromSession,
  subscribe,
} from "@/modules/core/index.js";
import * as eventsModule from "@/modules/core/events.js";

const input = {
  sellerName: "Event Seller",
  sellerEmail: "events@example.test",
  itemSummary: "Coleman 220 stove",
  feeOfferedCents: 2500,
};

describe("createInvitation events (F01-FIX-4)", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
    resetEventBus();
  });

  afterEach(() => {
    resetEventBus();
    vi.restoreAllMocks();
  });

  it("AC: after a commit there is exactly one InvitationCreated audit row and handlers run once", async () => {
    const staff = asStaff();
    const actor = staffFromSession(staff.session);
    const handler = vi.fn();
    subscribe(EVENTS.InvitationCreated, handler);

    const { invitation, listing, token } = await createInvitation(input, actor);

    const rows = await prisma.auditEvent.findMany({
      where: { action: "InvitationCreated" },
    });
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.listingId).toBe(listing.id);
    expect(row.actor).toBe("STAFF");
    expect(row.actorRef).toBe(staff.session.email);
    expect(JSON.stringify(row.details)).not.toContain(token);

    expect(handler).toHaveBeenCalledTimes(1);
    const [payload, meta] = handler.mock.calls[0];
    expect(payload).toEqual({
      invitationId: invitation.id,
      listingId: listing.id,
    });
    expect(meta.auditId).toBe(row.id);
  });

  it("AC: rollback leaves no InvitationCreated row and runs no handler", async () => {
    const staff = asStaff();
    const actor = staffFromSession(staff.session);
    const handler = vi.fn();
    subscribe(EVENTS.InvitationCreated, handler);

    // Let the real recordEvent write the audit row inside the transaction, then fail.
    const realRecordEvent = eventsModule.recordEvent;
    const dbError = Object.assign(new Error("Database connection lost"), {
      code: "P1001",
    });
    const spy = vi
      .spyOn(eventsModule, "recordEvent")
      .mockImplementationOnce(async (...args) => {
        await realRecordEvent(...args);
        throw dbError;
      });

    await expect(createInvitation(input, actor)).rejects.toBe(dbError);
    expect(spy).toHaveBeenCalledTimes(1);

    expect(
      await prisma.auditEvent.count({
        where: { action: "InvitationCreated" },
      }),
    ).toBe(0);
    expect(await prisma.invitation.count()).toBe(0);
    expect(await prisma.listing.count()).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });
});
