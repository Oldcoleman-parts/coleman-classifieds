import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { mockSes } from "@/../tests/factories.js";
import { resolveToken } from "@/modules/access/index.js";
import {
  loadInvitationScreen,
  submitCreateInvitation,
} from "@/modules/access/services/screens.js";
import { setSesClient } from "@/modules/notifications/index.js";
import { suppress } from "@/modules/notifications/services/suppression.js";
import {
  BASE,
  inviteForm,
  setUpInvitationEmail,
  sesDown,
  staffContext,
  tokenIn,
  tokenOfLink,
} from "./invitation-email-helpers.js";

describe("Invitation email on create (F04-FIX-3)", () => {
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

  it("AC: creating an invitation sends one invitation email with a working link", async () => {
    const ses = mockSes();
    setSesClient(ses);
    const { actor, shopify } = staffContext();
    const form = inviteForm();

    const result = await submitCreateInvitation(form, actor, shopify);

    expect(result.ok).toBe(true);
    expect(ses.send).toHaveBeenCalledTimes(1);
    expect(ses.sent[0].input.Destination.ToAddresses).toEqual([
      form.get("sellerEmail"),
    ]);
    const token = tokenIn(ses.sent[0]);
    expect(result.link).toBe(`${BASE}/apps/classifieds/seller/${token}`);
    expect(result.email.state).toBe("SENT");
    expect((await resolveToken(token)).state).toBe("OK");
  });

  it.each([
    ["one after another", async (submit) => [await submit(), await submit()]],
    ["at the same time", (submit) => Promise.all([submit(), submit()])],
  ])(
    "AC: a double submit (%s) with the same form code creates one invitation and sends one email",
    async (_, run) => {
      const ses = mockSes();
      setSesClient(ses);
      const { actor, shopify } = staffContext();
      const formNonce = inviteForm().get("formNonce");
      const submit = () =>
        submitCreateInvitation(inviteForm({ formNonce }), actor, shopify);

      const results = await run(submit);

      expect(results.map((r) => r.duplicate).sort()).toEqual([false, true]);
      const second = results.find((r) => r.duplicate);
      expect(second.link).toBeNull();
      expect(await prisma.invitation.count()).toBe(1);
      expect(await prisma.listing.count()).toBe(1);
      expect(ses.send).toHaveBeenCalledTimes(1);
      expect(
        await prisma.emailOutbox.count({
          where: { templateKey: "invitation" },
        }),
      ).toBe(1);
    },
  );

  it("AC: when the send fails the invitation exists, the result says not sent and shows the link", async () => {
    setSesClient(sesDown());
    const { actor, shopify } = staffContext();

    const result = await submitCreateInvitation(inviteForm(), actor, shopify);

    expect(result.ok).toBe(true);
    expect(await prisma.invitation.count()).toBe(1);
    expect(result.email.state).toBe("NOT_SENT");
    expect(result.link).toMatch(/\/apps\/classifieds\/seller\//);
    expect((await resolveToken(tokenOfLink(result.link))).state).toBe("OK");

    const screen = await loadInvitationScreen(result.invitationId);
    expect(screen.email.state).toBe("NOT_SENT");
  });

  it("AC: a failed send is recorded in the InvitationEmailed audit entry with no link", async () => {
    setSesClient(sesDown());
    const { actor, shopify } = staffContext();

    const result = await submitCreateInvitation(inviteForm(), actor, shopify);

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "InvitationEmailed", listingId: result.listingId },
    });
    expect(audit.details.outcome).toBe("FAILED");
    expect(JSON.stringify(audit.details)).not.toContain(
      tokenOfLink(result.link),
    );
  });

  it("AC: an address that bounced shows not delivered on the invitation screen", async () => {
    const ses = mockSes();
    setSesClient(ses);
    const { actor, shopify } = staffContext();
    const result = await submitCreateInvitation(inviteForm(), actor, shopify);
    expect((await loadInvitationScreen(result.invitationId)).email.state).toBe(
      "SENT",
    );

    await suppress(result.sellerEmail, "BOUNCE");

    const screen = await loadInvitationScreen(result.invitationId);
    expect(screen.email.state).toBe("NOT_DELIVERED");
  });

  it("AC: creating to a suppressed address shows not delivered and the link to copy", async () => {
    const ses = mockSes();
    setSesClient(ses);
    const { actor, shopify } = staffContext();
    const address = "bounced@example.test";
    await suppress(address, "BOUNCE");

    const result = await submitCreateInvitation(
      inviteForm({ sellerEmail: address }),
      actor,
      shopify,
    );

    expect(result.email.state).toBe("NOT_DELIVERED");
    expect(result.link).toMatch(/\/apps\/classifieds\/seller\//);
    expect(ses.send).not.toHaveBeenCalled();
  });
});
