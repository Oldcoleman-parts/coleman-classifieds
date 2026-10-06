import { describe, expect, it } from "vitest";
import {
  codePage,
  escapeHtml,
  listingPlaceholder,
  statePage,
} from "@/modules/access/services/seller-pages.js";

const liquid = (body, init) => new Response(body, init);
const TOKEN = "a".repeat(43);

describe("Seller pages (AC + SEC)", () => {
  it("SEC: seller text can't become HTML or Liquid on the page", async () => {
    const invitation = {
      id: "inv_1",
      sellerName: "Sam<script>alert(1)</script> {{ shop.name }}",
      sellerEmail: "sam@example.test",
      itemSummary: "Coleman 200A {% render 'x' %} <img src=x>",
      feeOfferedCents: 2500,
    };

    const body = await listingPlaceholder(liquid, { invitation }).text();

    expect(body).not.toMatch(/<script>alert|<img src=x|\{\{|\{%/);
    expect(body).toContain("Coleman 200A");
    expect(body).toContain("$25.00");
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
