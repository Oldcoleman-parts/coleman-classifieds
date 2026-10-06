import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { resetDb } from "@/../tests/db.js";
import { makeInvitation, asStaff, mockSes } from "@/../tests/factories.js";
import {
  createInvitation,
  resolveToken,
  requestEmailCode,
  verifyEmailCode,
} from "@/modules/access/index.js";
import { setSesClient } from "@/modules/notifications/index.js";
import { staffFromSession } from "@/modules/core/index.js";
import { resetRateLimits } from "@/modules/access/services/rate-limit.js";

describe("SEC: Tokens and codes never appear in logs", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
    resetRateLimits();
    process.env.SES_FROM_TRANSACTIONAL = "transactional@example.test";
    process.env.SES_CONFIG_SET_TRANSACTIONAL = "tx-set";
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    setSesClient(null);
    delete process.env.SES_FROM_TRANSACTIONAL;
    delete process.env.SES_CONFIG_SET_TRANSACTIONAL;
    console.log.mockRestore();
    console.info.mockRestore();
    console.warn.mockRestore();
    console.error.mockRestore();
  });

  it("SEC: createInvitation logs don't contain the token", async () => {
    const { token } = await createInvitation(
      {
        sellerName: "Test Seller",
        sellerEmail: "test@example.test",
        itemSummary: "Coleman 220",
      },
      staffFromSession(asStaff().session),
    );

    const allLogs = [
      ...console.log.mock.calls,
      ...console.info.mock.calls,
      ...console.warn.mock.calls,
      ...console.error.mock.calls,
    ]
      .map((call) => call.join(" "))
      .join(" ");

    expect(allLogs).not.toContain(token);
  });

  it("SEC: resolveToken with valid token doesn't log it", async () => {
    const { token } = await createInvitation(
      {
        sellerName: "Pat Seller",
        sellerEmail: "pat@example.test",
        itemSummary: "Coleman 200A lantern",
      },
      staffFromSession(asStaff().session),
    );
    console.log.mockClear();
    console.info.mockClear();
    console.warn.mockClear();
    console.error.mockClear();

    expect((await resolveToken(token)).state).toBe("OK");

    const allLogs = [
      ...console.log.mock.calls,
      ...console.info.mock.calls,
      ...console.warn.mock.calls,
      ...console.error.mock.calls,
    ]
      .map((call) => call.join(" "))
      .join(" ");

    expect(allLogs).not.toContain(token);
  });

  it("SEC: resolveToken with invalid token doesn't log it", async () => {
    const badToken = "this-is-a-bad-token-that-should-never-log";

    await resolveToken(badToken);

    const allLogs = [
      ...console.log.mock.calls,
      ...console.info.mock.calls,
      ...console.warn.mock.calls,
      ...console.error.mock.calls,
    ]
      .map((call) => call.join(" "))
      .join(" ");

    expect(allLogs).not.toContain(badToken);
  });

  it("SEC: requestEmailCode doesn't log the code", async () => {
    const ses = mockSes();
    setSesClient(ses);
    const invitation = await makeInvitation();

    await requestEmailCode(invitation, { ip: "1.2.3.4" });

    const allLogs = [
      ...console.log.mock.calls,
      ...console.info.mock.calls,
      ...console.warn.mock.calls,
      ...console.error.mock.calls,
    ]
      .map((call) => call.join(" "))
      .join(" ");

    const code = JSON.stringify(ses.sent[0].input).match(/\b(\d{6})\b/)?.[1];
    expect(code).toMatch(/^\d{6}$/);
    expect(allLogs).not.toContain(code);
  });

  it("SEC: verifyEmailCode with wrong code doesn't log it", async () => {
    const ses = mockSes();
    setSesClient(ses);
    const invitation = await makeInvitation();

    await requestEmailCode(invitation, { ip: "1.2.3.4" });
    const wrongCode = "000000";
    await verifyEmailCode(invitation, wrongCode, { ip: "1.2.3.4" });

    const allLogs = [
      ...console.log.mock.calls,
      ...console.info.mock.calls,
      ...console.warn.mock.calls,
      ...console.error.mock.calls,
    ]
      .map((call) => call.join(" "))
      .join(" ");

    expect(allLogs).not.toContain(wrongCode);
  });

  it("SEC: verifyEmailCode with right code doesn't log it", async () => {
    const ses = mockSes();
    setSesClient(ses);
    const invitation = await makeInvitation();

    await requestEmailCode(invitation, { ip: "1.2.3.4" });

    const code = JSON.stringify(ses.sent[0].input).match(/\b(\d{6})\b/)?.[1];
    expect(code).toMatch(/^\d{6}$/);
    const result = await verifyEmailCode(invitation, code, { ip: "1.2.3.4" });
    expect(result.state).toBe("OK");

    const allLogs = [
      ...console.log.mock.calls,
      ...console.info.mock.calls,
      ...console.warn.mock.calls,
      ...console.error.mock.calls,
    ]
      .map((call) => call.join(" "))
      .join(" ");

    expect(allLogs).not.toContain(code);
  });

  it("SEC: a failed code email logs the error type only, never the code", async () => {
    const ses = mockSes();
    ses.send.mockRejectedValue(
      Object.assign(new Error("down"), { name: "ServiceUnavailable" }),
    );
    setSesClient(ses);
    const invitation = await makeInvitation();

    await requestEmailCode(invitation, { ip: "1.2.3.4" });

    const code = JSON.stringify(ses.send.mock.calls[0][0].input).match(
      /\b(\d{6})\b/,
    )?.[1];
    expect(code).toMatch(/^\d{6}$/);
    const allLogs = [
      ...console.log.mock.calls,
      ...console.info.mock.calls,
      ...console.warn.mock.calls,
      ...console.error.mock.calls,
    ]
      .map((call) => call.join(" "))
      .join(" ");
    expect(allLogs).not.toContain(code);
  });
});
