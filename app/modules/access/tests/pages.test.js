import { describe, expect, it } from "vitest";
import {
  codePage,
  escapeHtml,
  scriptJson,
  statePage,
} from "@/modules/access/services/seller-pages.js";

const liquid = (body, init) => new Response(body, init);
const TOKEN = "a".repeat(43);

describe("Seller pages (AC + SEC)", () => {
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
    const body = await statePage(liquid, "CLOSED", "DEADLINE").text();

    expect(body).toContain("The deadline for this listing has passed");
  });

  it("SEC: the code page shows a masked email only", async () => {
    const invitation = { id: "inv_1", sellerEmail: "pat.seller@example.test" };

    const body = await codePage(liquid, { token: TOKEN, invitation }).text();

    expect(body).not.toContain("pat.seller@");
    expect(body).toContain("p•••@example.test");
  });

  it.each(["INVALID", "EXPIRED", "REVOKED", "CLOSED"])(
    "SEC: the %s page sends no-referrer and no-store",
    (state) => {
      const response = statePage(liquid, state);

      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    },
  );

  it("SEC: escapeHtml escapes every character that could start HTML or Liquid", () => {
    expect(escapeHtml(`<>"'{}%&`)).toBe(
      "&lt;&gt;&quot;&#39;&#123;&#125;&#37;&amp;",
    );
  });
});
