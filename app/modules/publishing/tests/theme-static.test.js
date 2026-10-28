import { describe, expect, it } from "vitest";
import { outputs, read, THEME_FILES } from "./theme-render.js";

// Outputs that aren't seller data: translated strings, the pager, and a loop counter.
const NOT_SELLER_DATA = [
  /^'[\w.]+'\s*\|\s*t$/,
  /^paginate \| default_pagination$/,
  /^forloop\.index$/,
];
// The gallery's alt text is built with a `capture` and then passed to classifieds-img, which
// escapes it (`alt="{{ alt | escape }}"`). The text is escaped where it reaches the page.
const ESCAPED_AT_SINK = { listing: "metaobject.title.value" };

const SOURCES = Object.entries(THEME_FILES).map(([name, path]) => [name, read(path)]);

describe("Theme templates, static checks (F06-T2)", () => {
  it("SEC: every output of a field, a setting or a variable is escaped", () => {
    const unescaped = [];
    for (const [name, source] of SOURCES)
      for (const expr of outputs(source)) {
        if (expr.includes("escape")) continue;
        if (NOT_SELLER_DATA.some((pattern) => pattern.test(expr))) continue;
        if (ESCAPED_AT_SINK[name] === expr) continue;
        unescaped.push(`${name}: ${expr}`);
      }
    expect(unescaped).toEqual([]);
  });

  it("SEC: no template contains a script tag, raw output or a form", () => {
    for (const [, source] of SOURCES) {
      expect(source).not.toMatch(/<script/i);
      expect(source).not.toMatch(/\|\s*raw\b/);
    }
  });

  it("SEC: the listing, card and browse templates have no form, cart or product markup", () => {
    for (const name of ["listing", "card", "browse"]) {
      const source = read(THEME_FILES[name]);
      expect(source).not.toMatch(/<form|add-to-cart|product-form|\/cart/i);
    }
  });
});
