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
import {
  handleMyLinkPage,
  handleMyLinkRequest,
  gateSeller,
  getLinkUrl,
  resolveToken,
} from "@/modules/access/index.js";
import { hashSecret, newToken } from "@/modules/access/services/tokens.js";
import { setSesClient } from "@/modules/notifications/index.js";
import { setTurnstileFetch } from "@/modules/access/services/turnstile.js";
import {
  resetLinkCache,
  setLinkBase,
} from "@/modules/access/services/links.js";
import { action, loader } from "@/routes/proxy.my-link.jsx";
import { setUp, callMyLink, signedUrl } from "./my-link-helpers.js";

/** Assert standalone my-link page (form allows one Turnstile script). */
async function expectMyLinkStandalone(
  response,
  { allowTurnstile = false } = {},
) {
  const body = await response.text();

  // Headers must be set correctly
  expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");

  // Must start with layout none
  expect(body.trim()).toMatch(/^{%\s*layout\s+none\s*%}/);

  // Must have standalone document structure
  expect(body).toContain("<!doctype html>");
  expect(body).toContain(`lang="en"`);
  expect(body).toContain('charset="utf-8"');
  expect(body).toContain("viewport");
  expect(body).toContain('name="robots" content="noindex, nofollow"');
  expect(body).toContain('name="referrer" content="no-referrer"');
  expect(body).toContain("<title>");

  // No stylesheet links
  expect(body).not.toMatch(/<link[^>]+rel="?stylesheet"?/);
  expect(body).not.toMatch(/@import\s+["']https?:\/\//);
  expect(body).not.toMatch(/url\s*\(\s*["']?https?:\/\//);

  if (allowTurnstile) {
    // Form page may have exactly one Turnstile script and no other <script src>
    const scriptSrcMatches = [
      ...body.matchAll(/<script[^>]+src=["']?([^"'>]+)/g),
    ];
    const nonTurnstileScripts = scriptSrcMatches.filter(
      (m) => !m[1].includes("challenges.cloudflare.com/turnstile"),
    );
    expect(nonTurnstileScripts).toHaveLength(0);
    expect(body).toContain(
      "https://challenges.cloudflare.com/turnstile/v0/api.js",
    );
  } else {
    // Other my-link pages have no <script src> at all
    expect(body).not.toMatch(/<script[^>]+src=/);
  }

  return body;
}

describe("F04-T3: Get my link", () => {
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
  });

  afterEach(() => {
    setSesClient(null);
    setTurnstileFetch(null);
    resetLinkCache();
    delete process.env.TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.SES_FROM_TRANSACTIONAL;
    delete process.env.SES_CONFIG_SET_TRANSACTIONAL;
  });

  it("AC1: seller with 3 open listings and 1 SOLD gets one email with 3 links; old tokens invalid", async () => {
    const email = "pat@example.test";
    const open = ["INVITED", "DRAFT", "SUBMITTED"];
    const sold = "SOLD";

    const oldTokens = [0, 1, 2, 3].map(() => newToken());
    const listings = await Promise.all([
      makeListing({
        status: open[0],
        invitation: { sellerEmail: email, tokenHash: hashSecret(oldTokens[0]) },
      }),
      makeListing({
        status: open[1],
        invitation: { sellerEmail: email, tokenHash: hashSecret(oldTokens[1]) },
        draftDueBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }),
      makeListing({
        status: open[2],
        invitation: { sellerEmail: email, tokenHash: hashSecret(oldTokens[2]) },
      }),
      makeListing({
        status: sold,
        invitation: { sellerEmail: email, tokenHash: hashSecret(oldTokens[3]) },
      }),
    ]);
    // The links worked before the request.
    for (const token of oldTokens.slice(0, 3))
      expect((await resolveToken(token)).state).toBe("OK");

    const oldHashes = listings.map((l) => l.invitation.tokenHash);

    const ses = mockSes();
    setSesClient(ses);

    const response = await callMyLink(handleMyLinkRequest, {
      email: "  PAT@Example.test ",
      "cf-turnstile-response": "test-response",
    });

    expect(response.status).toBe(200);
    expect(ses.sent).toHaveLength(1);
    expect(ses.sent[0].input.Destination.ToAddresses).toEqual([email]);

    // The email carries three new links; each opens its listing, the old ones no longer do.
    const sentText = JSON.stringify(ses.sent[0].input);
    const newTokens = [
      ...new Set(
        [...sentText.matchAll(/\/seller\/([A-Za-z0-9_-]{43})/g)].map(
          (match) => match[1],
        ),
      ),
    ];
    expect(newTokens).toHaveLength(3);
    const opened = await Promise.all(newTokens.map((t) => resolveToken(t)));
    expect(opened.map((r) => r.state)).toEqual(["OK", "OK", "OK"]);
    expect(opened.map((r) => r.invitation.id).sort()).toEqual(
      listings
        .slice(0, 3)
        .map((l) => l.invitationId)
        .sort(),
    );
    for (const token of oldTokens.slice(0, 3)) {
      const gate = await gateSeller(
        { liquid: (body, init) => new Response(body, init) },
        new Request("https://app.example.test/"),
        token,
      );
      expect(gate.response.status).toBe(200);
      expect(await gate.response.text()).toContain("This link doesn’t work");
    }
    expect((await resolveToken(oldTokens[3])).state).toBe("CLOSED");

    // Hashes should have changed for the 3 open listings
    for (let i = 0; i < 3; i++) {
      const oldHash = listings[i].invitation.tokenHash;
      const updated = await prisma.invitation.findUnique({
        where: { id: listings[i].invitationId },
      });
      expect(updated.tokenHash).not.toBe(oldHash);
    }

    // SOLD invitation hash should be unchanged
    const soldInvitation = await prisma.invitation.findUnique({
      where: { id: listings[3].invitationId },
    });
    expect(soldInvitation.tokenHash).toBe(oldHashes[3]);

    // Check audit events
    const audits = await prisma.auditEvent.findMany({
      where: { action: "SellerLinkReissued" },
    });
    expect(audits).toHaveLength(3);
    audits.forEach((audit) => {
      expect(audit.actor).toBe("SYSTEM");
      expect(audit.details).toHaveProperty("invitationId");
    });
  });

  it("AC2: unknown address gets same reply, no email, no audit", async () => {
    const known = await makeListing({
      status: "SUBMITTED",
      invitation: { sellerEmail: "known@example.test" },
    });
    const ses = mockSes();
    setSesClient(ses);

    const knownReply = await callMyLink(handleMyLinkRequest, {
      email: "known@example.test",
      "cf-turnstile-response": "test-response",
    });
    expect(ses.sent).toHaveLength(1);
    const auditsBefore = await prisma.auditEvent.count({
      where: { action: "SellerLinkReissued" },
    });
    const hashAfter = (
      await prisma.invitation.findUnique({ where: { id: known.invitationId } })
    ).tokenHash;

    const response = await callMyLink(handleMyLinkRequest, {
      email: "unknown@example.test",
      "cf-turnstile-response": "test-response",
    });

    expect(response.status).toBe(knownReply.status);
    expect(await response.text()).toBe(await knownReply.text());
    expect(ses.sent).toHaveLength(1);
    expect(
      (
        await prisma.invitation.findUnique({
          where: { id: known.invitationId },
        })
      ).tokenHash,
    ).toBe(hashAfter);

    const audits = await prisma.auditEvent.findMany({
      where: { action: "SellerLinkReissued" },
    });
    expect(audits).toHaveLength(auditsBefore);
  });

  it("AC3: 4th POST for same address in a day changes nothing; 11th POST from one IP gives 429", async () => {
    const email = "sam@example.test";
    await makeListing({
      status: "DRAFT",
      invitation: { sellerEmail: email },
      draftDueBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const ses = mockSes();
    setSesClient(ses);

    // 3 posts should succeed
    for (let i = 0; i < 3; i++) {
      const response = await callMyLink(handleMyLinkRequest, {
        email,
        "cf-turnstile-response": "test-response",
      });
      expect(response.status).toBe(200);
    }
    expect(ses.sent).toHaveLength(3);

    // 4th post should give same reply but no email
    const response4 = await callMyLink(handleMyLinkRequest, {
      email,
      "cf-turnstile-response": "test-response",
    });
    expect(response4.status).toBe(200);
    expect(ses.sent).toHaveLength(3);

    // 11th post from same IP (different email) should give 429
    for (let i = 4; i < 10; i++) {
      const uniqueEmail = `user${i}@example.test`;
      await makeListing({
        status: "DRAFT",
        invitation: { sellerEmail: uniqueEmail },
        draftDueBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      await callMyLink(handleMyLinkRequest, {
        email: uniqueEmail,
        "cf-turnstile-response": "test-response",
      });
    }

    const response11 = await callMyLink(handleMyLinkRequest, {
      email: "user11@example.test",
      "cf-turnstile-response": "test-response",
    });
    expect(response11.status).toBe(429);
  });

  it("AC4: honeypot filled → no send, no hash change", async () => {
    const email = "test@example.test";
    await makeListing({
      status: "DRAFT",
      invitation: { sellerEmail: email },
      draftDueBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const ses = mockSes();
    setSesClient(ses);

    const response = await callMyLink(handleMyLinkRequest, {
      email,
      website: "spam.example.com",
      "cf-turnstile-response": "test-response",
    });

    expect(response.status).toBe(200);
    expect(ses.sent).toHaveLength(0);
  });

  it("AC4: Turnstile fails → no send, no hash change", async () => {
    const email = "test@example.test";
    await makeListing({
      status: "DRAFT",
      invitation: { sellerEmail: email },
      draftDueBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    setTurnstileFetch(
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ success: false }),
      })),
    );

    const ses = mockSes();
    setSesClient(ses);

    const response = await callMyLink(handleMyLinkRequest, {
      email,
      "cf-turnstile-response": "test-response",
    });

    expect(response.status).toBe(400);
    expect(ses.sent).toHaveLength(0);
  });

  it("AC4: missing TURNSTILE_SECRET_KEY → no send, no hash change", async () => {
    const email = "test@example.test";
    await makeListing({
      status: "DRAFT",
      invitation: { sellerEmail: email },
      draftDueBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    delete process.env.TURNSTILE_SECRET_KEY;

    const ses = mockSes();
    setSesClient(ses);

    const response = await callMyLink(handleMyLinkRequest, {
      email,
      "cf-turnstile-response": "test-response",
    });

    expect(response.status).toBe(400);
    expect(ses.sent).toHaveLength(0);
  });

  it("Excluded: expired INVITED invitation not included", async () => {
    const email = "test@example.test";
    const pastExpiry = new Date(Date.now() - 1000);

    await makeListing({
      status: "INVITED",
      invitation: { sellerEmail: email, expiresAt: pastExpiry },
    });
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

    expect(ses.sent).toHaveLength(1);
  });

  it("Excluded: DRAFT past draftDueBy not included", async () => {
    const email = "test@example.test";
    const pastDeadline = new Date(Date.now() - 1000);

    await makeListing({
      status: "DRAFT",
      invitation: { sellerEmail: email },
      draftDueBy: pastDeadline,
    });
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

    expect(ses.sent).toHaveLength(1);
  });

  it("Excluded: REVOKED invitation not included", async () => {
    const email = "test@example.test";

    await makeListing({
      status: "DRAFT",
      invitation: { sellerEmail: email, status: "REVOKED" },
      draftDueBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
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

    expect(ses.sent).toHaveLength(1);
  });

  it("GET page: 200, X-Robots-Tag noindex, Referrer-Policy no-referrer", async () => {
    const response = await handleMyLinkPage(
      {
        liquid: (body, init) =>
          new Response(body, {
            status: init?.status ?? 200,
            headers: init?.headers,
          }),
      },
      new Request("https://app.example.test/my-link"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("GET page: has email field, honeypot, cf-turnstile widget", async () => {
    const body = await handleMyLinkPage(
      {
        liquid: (html) => new Response(html),
      },
      new Request("https://app.example.test/my-link"),
    ).then((r) => r.text());

    expect(body).toContain('id="cc-email"');
    expect(body).toContain('name="website"');
    expect(body).toContain('data-sitekey="test-site-key"');
  });

  it("AC3: the form page is standalone, with Turnstile as its only outside script", async () => {
    const response = await loader({
      request: new Request(signedUrl("/my-link")),
    });

    expect(response.status).toBe(200);
    const body = await expectMyLinkStandalone(response, {
      allowTurnstile: true,
    });
    expect(body).toContain('id="cc-email"');
  });

  it("AC3: the sent reply is standalone with no outside script", async () => {
    const form = new FormData();
    form.set("email", "test@example.test");
    form.set("cf-turnstile-response", "test-response");

    const response = await action({
      request: new Request(signedUrl("/my-link"), {
        method: "POST",
        body: form,
      }),
    });

    expect(response.status).toBe(200);
    const body = await expectMyLinkStandalone(response);
    expect(body).toContain("Check your email");
  });

  it("AC3: the 429 reply is standalone too", async () => {
    let response;
    for (let i = 0; i < 80 && response?.status !== 429; i++)
      response = await loader({ request: new Request(signedUrl("/my-link")) });

    expect(response.status).toBe(429);
    const body = await expectMyLinkStandalone(response);
    expect(body).toContain("Please wait a moment");
  });

  it("SES failure: same reply, old links resolve OK, no audit", async () => {
    const email = "test@example.test";
    const listing = await makeListing({
      status: "DRAFT",
      invitation: { sellerEmail: email },
      draftDueBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const oldTokenHash = listing.invitation.tokenHash;

    const ses = mockSes();
    ses.send.mockRejectedValue(new Error("Service unavailable"));
    setSesClient(ses);

    const response = await callMyLink(handleMyLinkRequest, {
      email,
      "cf-turnstile-response": "test-response",
    });

    expect(response.status).toBe(200);

    const audits = await prisma.auditEvent.findMany({
      where: { action: "SellerLinkReissued" },
    });
    expect(audits).toHaveLength(0);

    const invitation = await prisma.invitation.findUnique({
      where: { id: listing.invitationId },
    });
    expect(invitation.tokenHash).toBe(oldTokenHash);
  });

  it("getLinkUrl: returns https://oldcolemanparts.com/apps/classifieds/my-link", async () => {
    setLinkBase("test-shop", "https://oldcolemanparts.com");

    const { admin } = {
      admin: { graphql: vi.fn() },
    };

    const url = await getLinkUrl(admin, "test-shop");
    expect(url).toBe("https://oldcolemanparts.com/apps/classifieds/my-link");
  });
});
