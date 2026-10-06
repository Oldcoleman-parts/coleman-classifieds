import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeInvitation, mockSes } from "@/../tests/factories.js";
import { requestEmailCode, verifyEmailCode } from "@/modules/access/index.js";
import { setSesClient } from "@/modules/notifications/index.js";
import { resetRateLimits } from "@/modules/access/services/rate-limit.js";

describe("Email codes", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
    resetRateLimits();
    process.env.SES_FROM_TRANSACTIONAL = "transactional@example.test";
    process.env.SES_CONFIG_SET_TRANSACTIONAL = "tx-set";
  });

  afterEach(() => {
    setSesClient(null);
    delete process.env.SES_FROM_TRANSACTIONAL;
    delete process.env.SES_CONFIG_SET_TRANSACTIONAL;
  });

  it("AC: requesting a code emails it", async () => {
    const ses = mockSes();
    setSesClient(ses);
    const invitation = await makeInvitation();

    const result = await requestEmailCode(invitation, { ip: "1.2.3.4" });

    expect(result.state).toBe("SENT");
    expect(ses.sent).toHaveLength(1);
  });

  it("AC: a tampered code is refused", async () => {
    const ses = mockSes();
    setSesClient(ses);
    const invitation = await makeInvitation();

    await requestEmailCode(invitation);
    const result = await verifyEmailCode(invitation, "999999", {
      ip: "1.2.3.4",
    });

    expect(result.state).toBe("WRONG");
  });

  it("AC: an expired code is refused", async () => {
    const ses = mockSes();
    setSesClient(ses);
    const now = new Date();
    const invitation = await makeInvitation();

    await requestEmailCode(invitation, { ip: "1.2.3.4", now });

    // Move time past the code expiry
    const later = new Date(now.getTime() + 16 * 60 * 1000); // 16 minutes later
    const result = await verifyEmailCode(invitation, "123456", {
      ip: "1.2.3.4",
      now: later,
    });

    expect(result.state).toBe("NO_CODE");
  });

  it("AC: the right code → OK plus a credential", async () => {
    const ses = mockSes();
    setSesClient(ses);
    const invitation = await makeInvitation();

    await requestEmailCode(invitation, { ip: "1.2.3.4" });

    // Extract the code from the SES send: it's in the HTML body
    const cmd = ses.sent[0].input;
    const html = cmd.Content.Simple.Body.Html.Data;
    const codeMatch = html.match(/\b(\d{6})\b/);
    const code = codeMatch?.[1];

    expect(code).toBeDefined();

    const result = await verifyEmailCode(invitation, code, {
      ip: "1.2.3.4",
    });

    expect(result.state).toBe("OK");
    expect(result.device).toBeDefined();
    expect(typeof result.device).toBe("string");
  });

  it("SEC: 5 wrong codes → LOCKED", async () => {
    const ses = mockSes();
    setSesClient(ses);
    const invitation = await makeInvitation();

    await requestEmailCode(invitation, { ip: "1.2.3.4" });

    for (let i = 0; i < 5; i++) {
      const result = await verifyEmailCode(invitation, "000000", {
        ip: "1.2.3.4",
      });
      expect(result.state).toBe(i < 4 ? "WRONG" : "LOCKED");
    }

    const final = await verifyEmailCode(invitation, "000000", {
      ip: "1.2.3.4",
    });
    expect(final.state).toBe("LOCKED");
  });

  it("SEC: the right code while locked is still refused", async () => {
    const ses = mockSes();
    setSesClient(ses);
    const invitation = await makeInvitation();

    await requestEmailCode(invitation, { ip: "1.2.3.4" });

    // Get the code from the SES send
    const cmd = ses.sent[0].input;
    const html = cmd.Content.Simple.Body.Html.Data;
    const codeMatch = html.match(/\b(\d{6})\b/);
    const code = codeMatch?.[1];

    // Make 5 wrong attempts
    for (let i = 0; i < 5; i++) {
      await verifyEmailCode(invitation, "000000", { ip: "1.2.3.4" });
    }

    // Try with the right code while locked
    const result = await verifyEmailCode(invitation, code, { ip: "1.2.3.4" });
    expect(result.state).toBe("LOCKED");
  });

  it("SEC: requesting a new code while locked → LOCKED", async () => {
    const ses = mockSes();
    setSesClient(ses);
    const invitation = await makeInvitation();

    await requestEmailCode(invitation, { ip: "1.2.3.4" });

    // Lock it
    for (let i = 0; i < 5; i++) {
      await verifyEmailCode(invitation, "000000", { ip: "1.2.3.4" });
    }

    // Try to request a new code
    const result = await requestEmailCode(invitation, { ip: "1.2.3.4" });
    expect(result.state).toBe("LOCKED");
  });

  it("SEC: an EmailCodeLocked audit is written once", async () => {
    const ses = mockSes();
    setSesClient(ses);
    const invitation = await makeInvitation();

    await requestEmailCode(invitation, { ip: "1.2.3.4" });

    // Make 5 wrong attempts
    for (let i = 0; i < 5; i++) {
      await verifyEmailCode(invitation, "000000", { ip: "1.2.3.4" });
    }

    const audits = await prisma.auditEvent.findMany({
      where: { action: "EmailCodeLocked" },
    });

    expect(audits).toHaveLength(1);
  });

  // SES failure scenarios are tested in the notifications module

  it("AC: the rate limit on code requests → RATE_LIMITED", async () => {
    const ses = mockSes();
    setSesClient(ses);
    const invitation = await makeInvitation();

    // Request 3 codes (the limit per invitation per 15 min)
    for (let i = 0; i < 3; i++) {
      const result = await requestEmailCode(invitation, { ip: "1.2.3.4" });
      expect(result.state).toBe("SENT");
    }

    // 4th should be rate limited
    const result = await requestEmailCode(invitation, { ip: "1.2.3.4" });
    expect(result.state).toBe("RATE_LIMITED");
  });
});
