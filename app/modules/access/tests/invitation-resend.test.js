import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { mockSes } from "@/../tests/factories.js";
import {
  checkDeviceCredential,
  handleInvitationAction,
  issueDeviceCredential,
  resolveToken,
  revokeInvitation,
  submitCreateInvitation,
} from "@/modules/access/index.js";
import { setSesClient } from "@/modules/notifications/index.js";
import { suppress } from "@/modules/notifications/services/suppression.js";
import {
  actionForm,
  inviteForm,
  setUpInvitationEmail,
  sesDown,
  staffContext,
  tokenIn,
  tokenOfLink,
} from "./invitation-email-helpers.js";

/** One invitation with its first email sent. Returns the ids and the first token. */
async function createSent() {
  const ses = mockSes();
  setSesClient(ses);
  const context = staffContext();
  const created = await submitCreateInvitation(
    inviteForm(),
    context.actor,
    context.shopify,
  );
  return {
    ses,
    ...context,
    invitationId: created.invitationId,
    sellerEmail: created.sellerEmail,
    oldToken: tokenIn(ses.sent[0]),
  };
}

const resend = (ctx) =>
  handleInvitationAction(
    ctx.invitationId,
    actionForm("resend"),
    ctx.actor,
    ctx.shopify,
  );

describe("Resend invitation email (F04-FIX-3)", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
    setUpInvitationEmail();
  });

  afterEach(() => {
    setSesClient(null);
  });

  it("AC: resend sends a new working link and the old link no longer opens the listing", async () => {
    const ctx = await createSent();

    const result = await resend(ctx);

    expect(result).toMatchObject({ ok: true, outcome: "SENT", link: null });
    expect(ctx.ses.send).toHaveBeenCalledTimes(2);
    const newToken = tokenIn(ctx.ses.sent[1]);
    expect(newToken).not.toBe(ctx.oldToken);
    expect((await resolveToken(newToken)).state).toBe("OK");
    expect((await resolveToken(ctx.oldToken)).state).toBe("INVALID");
  });

  it("AC: resend never changes the fee, the listing or the expiry date", async () => {
    const ctx = await createSent();
    const before = await prisma.invitation.findUniqueOrThrow({
      where: { id: ctx.invitationId },
      include: { listing: true },
    });

    await resend(ctx);

    const after = await prisma.invitation.findUniqueOrThrow({
      where: { id: ctx.invitationId },
      include: { listing: true },
    });
    expect(after.feeRegularCents).toBe(before.feeRegularCents);
    expect(after.feeOfferedCents).toBe(before.feeOfferedCents);
    expect(after.expiresAt).toEqual(before.expiresAt);
    expect(after.listing).toEqual(before.listing);
    expect(after.tokenHash).not.toBe(before.tokenHash);
  });

  it("AC: a device confirmed before the resend stays signed in", async () => {
    const ctx = await createSent();
    const device = issueDeviceCredential(ctx.invitationId);

    await resend(ctx);

    expect(checkDeviceCredential(device, ctx.invitationId)).toBe(true);
  });

  it("AC: the 6th resend in a day is refused, and failed sends count towards the 5", async () => {
    const ctx = await createSent();
    setSesClient(sesDown());
    for (let i = 0; i < 5; i++) {
      const sent = await resend(ctx);
      expect(sent).toMatchObject({ ok: true, outcome: "FAILED" });
    }
    const before = await prisma.invitation.findUniqueOrThrow({
      where: { id: ctx.invitationId },
    });

    const sixth = await resend(ctx);

    expect(sixth.ok).toBe(false);
    expect(sixth.message).toMatch(/5 times a day/);
    const after = await prisma.invitation.findUniqueOrThrow({
      where: { id: ctx.invitationId },
    });
    expect(after.tokenHash).toBe(before.tokenHash);
    expect(
      await prisma.auditEvent.count({
        where: { action: "InvitationResent", details: { path: ["invitationId"], equals: ctx.invitationId } },
      }),
    ).toBe(5);
  });

  it.each([
    [
      "used",
      async (ctx) =>
        prisma.listing.update({
          where: { invitationId: ctx.invitationId },
          data: { status: "DRAFT" },
        }),
    ],
    ["revoked", (ctx) => revokeInvitation(ctx.invitationId, ctx.actor)],
    [
      "expired",
      (ctx) =>
        prisma.invitation.update({
          where: { id: ctx.invitationId },
          data: { expiresAt: new Date(Date.now() - 1000) },
        }),
    ],
    ["suppressed-address", (ctx) => suppress(ctx.sellerEmail, "BOUNCE")],
  ])(
    "AC: a resend on an invitation that is %s is refused and changes nothing",
    async (_, makeState) => {
      const ctx = await createSent();
      await makeState(ctx);
      const before = await prisma.invitation.findUniqueOrThrow({
        where: { id: ctx.invitationId },
      });
      const sentBefore = ctx.ses.send.mock.calls.length;

      const result = await resend(ctx);

      expect(result.ok).toBe(false);
      const after = await prisma.invitation.findUniqueOrThrow({
        where: { id: ctx.invitationId },
      });
      expect(after.tokenHash).toBe(before.tokenHash);
      expect(ctx.ses.send.mock.calls.length).toBe(sentBefore);
      expect(
        await prisma.auditEvent.count({
          where: {
            action: "InvitationResent",
            details: { path: ["invitationId"], equals: ctx.invitationId },
          },
        }),
      ).toBe(0);
    },
  );

  it("AC: a failed resend returns a working new link to copy", async () => {
    const ctx = await createSent();
    setSesClient(sesDown());

    const result = await resend(ctx);

    expect(result).toMatchObject({ ok: true, outcome: "FAILED" });
    expect(result.link).toMatch(/\/apps\/classifieds\/seller\//);
    expect((await resolveToken(tokenOfLink(result.link))).state).toBe("OK");
    expect((await resolveToken(ctx.oldToken)).state).toBe("INVALID");
  });
});
