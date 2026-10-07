import { describe, expect, it, beforeEach } from "vitest";
import { prisma, resetDb } from "@/../tests/db.js";
import {
  codePage,
  escapeHtml,
  scriptJson,
  sellerLayout,
  statePage,
  tooManyRequests,
} from "@/modules/access/services/seller-pages.js";
import { updateEmailSettings } from "@/modules/notifications/index.js";

const TOKEN = "a".repeat(43);

/** Mock liquid helper that records the layout option. */
function recordingLiquid() {
  const calls = [];
  const fn = (body, init) => {
    calls.push({ body, init });
    return new Response(body, init);
  };
  fn.calls = calls;
  return fn;
}

const liquid = (body, init) => new Response(body, init);

describe("Seller pages (AC + SEC)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("SEC: inline script data can't close the tag or open Liquid", () => {
    const value = {
      text: "</script>{{ shop.name }}{% render 'x' %}",
      nested: { a: 1 },
    };

    const out = scriptJson(value);

    expect(out).not.toMatch(/<|\{\{|\{%/);
    expect(JSON.parse(out)).toEqual(value);
  });

  it("AC: a passed deadline shows its own closed page", async () => {
    const response = await statePage(liquid, "CLOSED", "DEADLINE");
    const body = await response.text();

    expect(body).toContain("The deadline for this listing has passed");
  });

  it("SEC: the code page shows a masked email only", async () => {
    const invitation = { id: "inv_1", sellerEmail: "pat.seller@example.test" };

    const response = await codePage(liquid, { token: TOKEN, invitation });
    const body = await response.text();

    expect(body).not.toContain("pat.seller@");
    expect(body).toContain("p•••@example.test");
  });

  it.each(["INVALID", "EXPIRED", "REVOKED", "CLOSED"])(
    "SEC: the %s page sends no-referrer and no-store",
    async (state) => {
      const response = await statePage(liquid, state);

      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    },
  );

  it("SEC: escapeHtml escapes every character that could start HTML or Liquid", () => {
    expect(escapeHtml(`<>"'{}%&`)).toBe(
      "&lt;&gt;&quot;&#39;&#123;&#125;&#37;&amp;",
    );
  });

  it("AC: sellerLayout() passes layout: false to liquid helper", async () => {
    const rec = recordingLiquid();

    await sellerLayout(rec, "Test Title", "<p>Test</p>");

    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0].init?.layout).toBe(false);
  });

  it("AC: sellerLayout title escapes Liquid syntax and HTML", async () => {
    const rec = recordingLiquid();

    await sellerLayout(
      rec,
      "Title with {{ variable }} and {% tag %} and <script>",
      "",
    );

    const body = rec.calls[0].body;
    expect(body).toContain("&#123;&#123;");
    expect(body).toContain("&#125;&#125;");
    expect(body).toContain("&#123;&#37;");
    expect(body).not.toContain("{{ variable }}");
    expect(body).not.toContain("{% tag %}");
    expect(body).not.toContain("<script>");
  });

  it("AC: sellerLayout body is preserved as-is (caller escapes)", async () => {
    const rec = recordingLiquid();
    const safeBody = "<p>This is already safe HTML</p>";

    await sellerLayout(rec, "Title", safeBody);

    const body = rec.calls[0].body;
    expect(body).toContain(safeBody);
  });

  it("AC: inline CSS in sellerLayout has no Liquid syntax", async () => {
    const rec = recordingLiquid();

    await sellerLayout(rec, "Test", "");

    const body = rec.calls[0].body;
    const styleMatch = body.match(/<style[^>]*>([\s\S]*?)<\/style>/);
    expect(styleMatch).toBeTruthy();
    const style = styleMatch[1];
    expect(style).not.toContain("{{");
    expect(style).not.toContain("{%");
  });

  it("AC: tooManyRequests passes layout: false (standalone)", async () => {
    const rec = recordingLiquid();

    await tooManyRequests(rec);

    expect(rec.calls[0].init?.layout).toBe(false);
    expect(rec.calls[0].init?.status).toBe(429);
  });

  it("AC: with logo URL, page shows img with src and sender name as alt", async () => {
    await updateEmailSettings(
      { logoUrl: "https://example.test/logo.png", senderName: "Admin" },
      { type: "STAFF", ref: "staff@test" },
    );

    const response = await statePage(
      (body, init) => new Response(body, init),
      "INVALID",
    );
    const body = await response.text();

    expect(body).toContain('class="cc-logo"');
    expect(body).toContain("https://example.test/logo.png");
    expect(body).toContain('alt="Admin"');
  });

  it("AC: without logo, page shows wordmark text (no img)", async () => {
    // Reset email settings to empty/default
    await prisma.emailSettings.deleteMany({});

    const response = await statePage(
      (body, init) => new Response(body, init),
      "INVALID",
    );
    const body = await response.text();

    expect(body).not.toContain('class="cc-logo"');
    expect(body).not.toContain("<img");
    expect(body).toContain("Old Coleman Parts");
  });

  it("SEC: a logo link or sender name can't inject HTML or Liquid into the header", async () => {
    // Written straight to the table, past the settings validation.
    await prisma.emailSettings.deleteMany({});
    await prisma.emailSettings.create({
      data: {
        id: 1,
        fromAddress: "from@example.test",
        postalAddress: "1 Test St",
        staffNotify: [],
        logoUrl:
          'https://example.test/l.png"><script src="https://evil.test/x.js"></script>{{ shop.name }}',
        senderName: 'Ad"min<b>{% raw %}',
      },
    });

    const body = await (await statePage(liquid, "INVALID")).text();

    expect(body).toContain('class="cc-logo"');
    expect(body).toContain("https://example.test/l.png&quot;&gt;&lt;script");
    expect(body).toContain("Ad&quot;min&lt;b&gt;");
    expect(body).not.toMatch(/<script[^>]+src=/);
    expect(body).not.toContain("{{");
    expect(body).not.toContain("{%");
  });
});
