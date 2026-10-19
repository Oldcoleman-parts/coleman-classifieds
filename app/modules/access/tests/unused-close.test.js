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
import { makeListing, asStaff } from "@/../tests/factories.js";
import { revokeInvitation } from "@/modules/access/index.js";
import { runExpiry } from "@/modules/access/services/expiry.js";
import { staffFromSession } from "@/modules/core/index.js";

const NOW = new Date("2027-03-10T15:00:00Z");
const PAST = new Date("2027-03-09T15:00:00Z");
const STAFF_EMAIL = "staff@example.test";

const auditFor = (listingId) =>
  prisma.auditEvent.findMany({ where: { listingId } });

/**
 * Simulates the seller opening the link between the expiry query and its loop: the next
 * `findMany` runs as usual, then the listing moves to DRAFT while its invitation stays OPEN.
 * The delegate method restores itself after one call.
 */
function raceNextFind(listingId) {
  const delegate = prisma.invitation;
  const original = delegate.findMany;
  delegate.findMany = async (args) => {
    delegate.findMany = original;
    const rows = await original.call(delegate, args);
    await prisma.listing.update({
      where: { id: listingId },
      data: { status: "DRAFT" },
    });
    return rows;
  };
}

const expiredInvitation = (overrides = {}) => ({
  invitation: { expiresAt: PAST, status: "OPEN", ...overrides },
  status: "INVITED",
});

describe("Unused invitation closed on expiry or revoke (F01-FIX-3)", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("AC: runExpiry closes the listing with INVITATION_EXPIRED, purgeAfter and one InvitationExpired row", async () => {
    const listing = await makeListing(expiredInvitation());

    const result = await runExpiry({ now: NOW });

    expect(result.expired).toBe(1);
    const row = await prisma.listing.findUnique({ where: { id: listing.id } });
    expect(row.status).toBe("INVITED");
    expect(row.closedReason).toBe("INVITATION_EXPIRED");
    expect(row.closedAt).toEqual(NOW);
    expect(row.purgeAfter).not.toBeNull();

    const audit = await auditFor(listing.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("InvitationExpired");
    expect(audit[0].actor).toBe("SYSTEM");
  });

  it("AC: a second runExpiry run changes nothing and adds no audit row", async () => {
    const listing = await makeListing(expiredInvitation());

    await runExpiry({ now: NOW });
    const before = await prisma.listing.findUnique({
      where: { id: listing.id },
    });
    const second = await runExpiry({ now: NOW });

    expect(second.expired).toBe(0);
    const after = await prisma.listing.findUnique({
      where: { id: listing.id },
    });
    expect(after.closedAt).toEqual(before.closedAt);
    expect(after.purgeAfter).toEqual(before.purgeAfter);
    expect(await auditFor(listing.id)).toHaveLength(1);
  });

  it("AC: revokeInvitation closes the listing with INVITATION_REVOKED and one InvitationRevoked row with the staff email", async () => {
    const listing = await makeListing({
      invitation: { status: "OPEN" },
      status: "INVITED",
    });

    const revoked = await revokeInvitation(
      listing.invitationId,
      staffFromSession(asStaff({ email: STAFF_EMAIL }).session),
    );

    expect(revoked).toBe(true);
    const row = await prisma.listing.findUnique({ where: { id: listing.id } });
    expect(row.status).toBe("INVITED");
    expect(row.closedReason).toBe("INVITATION_REVOKED");
    expect(row.purgeAfter).not.toBeNull();

    const audit = await auditFor(listing.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("InvitationRevoked");
    expect(audit[0].actor).toBe("STAFF");
    expect(audit[0].actorRef).toBe(STAFF_EMAIL);
  });

  it("AC: a repeat revoke changes nothing and adds no audit row", async () => {
    const listing = await makeListing({
      invitation: { status: "OPEN" },
      status: "INVITED",
    });
    const staff = staffFromSession(asStaff().session);

    await revokeInvitation(listing.invitationId, staff);
    const again = await revokeInvitation(listing.invitationId, staff);

    expect(again).toBe(false);
    expect(await auditFor(listing.id)).toHaveLength(1);
  });

  it("AC: revoke refuses a listing that is no longer INVITED and writes nothing", async () => {
    const listing = await makeListing({
      invitation: { status: "OPEN" },
      status: "DRAFT",
    });

    await expect(
      revokeInvitation(
        listing.invitationId,
        staffFromSession(asStaff().session),
      ),
    ).rejects.toThrow();

    const row = await prisma.listing.findUnique({ where: { id: listing.id } });
    expect(row.closedAt).toBeNull();
    expect(await auditFor(listing.id)).toHaveLength(0);
  });

  it("AC: a listing that left INVITED mid-run is refused alone; the other invitations still expire", async () => {
    const stale = await makeListing(expiredInvitation());
    const good = await makeListing(expiredInvitation());

    // Simulate the seller opening the link between the query and the loop:
    // the first listing moves to DRAFT while its invitation is still OPEN.
    raceNextFind(stale.id);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runExpiry({ now: NOW });

    expect(result.expired).toBe(1);
    const staleInvitation = await prisma.invitation.findUnique({
      where: { id: stale.invitationId },
    });
    expect(staleInvitation.status).toBe("OPEN");
    expect(await auditFor(stale.id)).toHaveLength(0);

    const goodRow = await prisma.listing.findUnique({ where: { id: good.id } });
    expect(goodRow.closedReason).toBe("INVITATION_EXPIRED");
    expect(await auditFor(good.id)).toHaveLength(1);
  });

  it("SEC: the expiry error log holds IDs and the error name only, no token, email or hash", async () => {
    const sellerEmail = "private-seller@example.test";
    const token = "super-secret-token-value";
    const stale = await makeListing(
      expiredInvitation({ sellerEmail, tokenHash: `hash-${token}` }),
    );

    raceNextFind(stale.id);
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runExpiry({ now: NOW });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(logSpy.mock.calls);
    expect(logged).toContain(stale.invitationId);
    expect(logged).not.toContain(sellerEmail);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain("hash-");
  });
});
