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
import { mockSes } from "@/../tests/factories.js";
import {
  handleInvitationAction,
  submitCreateInvitation,
} from "@/modules/access/index.js";
import { setSesClient } from "@/modules/notifications/index.js";
import {
  actionForm,
  inviteForm,
  setUpInvitationEmail,
  sesDown,
  STAFF_EMAIL,
  staffContext,
  tokenIn,
} from "./invitation-email-helpers.js";

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"];

describe("Invitation email security (F04-FIX-3)", () => {
  let consoleSpies = [];

  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
    setUpInvitationEmail();
    consoleSpies = CONSOLE_METHODS.map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
  });

  afterEach(() => {
    for (const spy of consoleSpies) spy.mockRestore();
    setSesClient(null);
  });

  it("SEC: the link and token appear in no console output, EmailOutbox row or AuditEvent", async () => {
    const ses = mockSes();
    setSesClient(ses);
    const { actor, shopify } = staffContext();
    const created = await submitCreateInvitation(inviteForm(), actor, shopify);
    const invitationId = created.invitationId;
    const tokens = [tokenIn(ses.sent[0])];
    await handleInvitationAction(
      invitationId,
      actionForm("resend"),
      actor,
      shopify,
    );
    tokens.push(tokenIn(ses.sent[1]));
    setSesClient(sesDown());
    await handleInvitationAction(
      invitationId,
      actionForm("resend"),
      actor,
      shopify,
    );

    const logged = consoleSpies.flatMap((spy) => spy.mock.calls).flat();
    const outbox = await prisma.emailOutbox.findMany();
    const audit = await prisma.auditEvent.findMany();
    const everything = JSON.stringify({ logged, outbox, audit });
    for (const token of tokens) {
      expect(everything).not.toContain(token);
      expect(everything).not.toContain(`/seller/${token}`);
    }
    const invitationRows = outbox.filter(
      (row) => row.templateKey === "invitation",
    );
    expect(invitationRows).toHaveLength(3);
    expect(invitationRows.every((row) => row.vars === null)).toBe(true);
  });

  it("SEC: InvitationEmailed and InvitationResent rows carry the staff email as actorRef", async () => {
    setSesClient(mockSes());
    const { actor, shopify } = staffContext();
    const created = await submitCreateInvitation(inviteForm(), actor, shopify);
    await handleInvitationAction(
      created.invitationId,
      actionForm("resend"),
      actor,
      shopify,
    );

    const rows = await prisma.auditEvent.findMany({
      where: { action: { in: ["InvitationEmailed", "InvitationResent"] } },
    });
    expect(rows.map((row) => row.action).sort()).toEqual([
      "InvitationEmailed",
      "InvitationEmailed",
      "InvitationResent",
    ]);
    for (const row of rows) {
      expect(row.actor).toBe("STAFF");
      expect(row.actorRef).toBe(STAFF_EMAIL);
    }
  });
});
