import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import prisma from "@/db.server";
import { makeListing, mockSes } from "@/../tests/factories.js";
import { handleMyLinkRequest } from "@/modules/access/index.js";
import { setSesClient } from "@/modules/notifications/index.js";
import { setTurnstileFetch } from "@/modules/access/services/turnstile.js";
import { setUp, callMyLink } from "./my-link-helpers.js";

describe("F04-T3: Get my link — Security", () => {
  beforeAll(async () => {
    await setUp();
  });

  beforeEach(async () => {
    await setUp();
    process.env.TURNSTILE_SITE_KEY = "test-site-key";
    process.env.TURNSTILE_SECRET_KEY = "test-secret-key";
    process.env.SES_FROM_TRANSACTIONAL = "transactional@example.test";
    process.env.SES_CONFIG_SET_TRANSACTIONAL = "tx-set";
    setTurnstileFetch(
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ success: true }),
      })),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    setSesClient(null);
    setTurnstileFetch(null);
    delete process.env.TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.SES_FROM_TRANSACTIONAL;
    delete process.env.SES_CONFIG_SET_TRANSACTIONAL;
    console.log.mockRestore();
    console.info.mockRestore();
    console.warn.mockRestore();
    console.error.mockRestore();
  });

  it("SEC: reissueSellerLinks sends no token or link in logs", async () => {
    const email = "test@example.test";
    await makeListing({
      status: "DRAFT",
      invitation: { sellerEmail: email },
      draftDueBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const ses = mockSes();
    setSesClient(ses);

    await callMyLink(handleMyLinkRequest, {
      email,
      "cf-turnstile-response": "test-response",
    });

    const allLogs = [
      ...console.log.mock.calls,
      ...console.info.mock.calls,
      ...console.warn.mock.calls,
      ...console.error.mock.calls,
    ]
      .map((call) => call.join(" "))
      .join(" ");

    // Should not contain the email (masked input)
    expect(allLogs).not.toContain("test@example.test");

    // Should not contain seller links (from the email body)
    const emailBody = JSON.stringify(ses.sent[0].input);
    const links =
      emailBody.match(
        /https:\/\/[^\s"]+\/apps\/classifieds\/seller\/[A-Za-z0-9_-]{43}/g,
      ) || [];
    expect(new Set(links).size).toBe(1);
    for (const link of links) {
      expect(allLogs).not.toContain(link);
      expect(allLogs).not.toContain(link.split("/").pop());
    }
  });

  it("SEC: audit events contain no token or link", async () => {
    const email = "pat@example.test";
    await makeListing({
      status: "DRAFT",
      invitation: { sellerEmail: email },
      draftDueBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const ses = mockSes();
    setSesClient(ses);

    await callMyLink(handleMyLinkRequest, {
      email,
      "cf-turnstile-response": "test-response",
    });

    const audits = await prisma.auditEvent.findMany({
      where: { action: "SellerLinkReissued" },
    });

    expect(audits).toHaveLength(1);
    const audit = audits[0];
    const detailsStr = JSON.stringify(audit.details);

    // Should contain invitationId, not token or hash
    expect(detailsStr).toContain("invitationId");
    expect(detailsStr).not.toMatch(/[A-Za-z0-9_-]{43}/);
    expect(detailsStr).not.toMatch(/[a-f0-9]{64}/);

    // Should not contain email
    expect(detailsStr).not.toContain(email);
  });

  it("SEC: typed email never appears in logs or audit", async () => {
    const email = "secret@example.test";
    await makeListing({
      status: "SUBMITTED",
      invitation: { sellerEmail: email },
    });

    const ses = mockSes();
    setSesClient(ses);

    await callMyLink(handleMyLinkRequest, {
      email,
      "cf-turnstile-response": "test-response",
    });

    const allLogs = [
      ...console.log.mock.calls,
      ...console.info.mock.calls,
      ...console.warn.mock.calls,
      ...console.error.mock.calls,
    ]
      .map((call) => call.join(" "))
      .join(" ");

    expect(allLogs).not.toContain(email);

    const audits = await prisma.auditEvent.findMany({
      where: { action: "SellerLinkReissued" },
    });
    for (const audit of audits) {
      expect(JSON.stringify(audit.details)).not.toContain(email);
    }
  });
});
