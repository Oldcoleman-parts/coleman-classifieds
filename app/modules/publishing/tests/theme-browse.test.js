import { describe, expect, it } from "vitest";
import { closedFields } from "@/modules/publishing/services/fields.js";
import { entryOf, OPEN_LISTING, openEntry, render } from "./theme-render.js";

const XSS = "<script>alert(1)</script>";
const ESCAPED = "&lt;script&gt;alert(1)&lt;/script&gt;";
const browseWith = (values) =>
  render("browse", {
    shop: {
      metafields: { classifieds: { live_count: { value: "3" } } },
      metaobjects: { classified_listing: { values } },
    },
  });

describe("Browse block, card and image (F06-T2)", () => {
  it("SEC: a script tag in a card's title renders as text", async () => {
    const html = await render("card", { entry: openEntry({ title: XSS }) });
    expect(html).toContain(ESCAPED);
    expect(html).not.toContain("<script");
  });

  it("SEC: a script tag in the browse page's card renders as text", async () => {
    const html = await browseWith([openEntry({ title: XSS })]);
    expect(html).toContain(ESCAPED);
    expect(html).not.toContain("<script");
  });

  it("AC: the browse page lists live cards only, and says so when there are none", async () => {
    const closed = entryOf(
      closedFields({ ...OPEN_LISTING, title: "Closed lamp", status: "SOLD" }),
    );
    const html = await browseWith([openEntry({ title: "Open lamp" }), closed]);
    expect(html).toContain("Open lamp");
    expect(html).not.toContain("Closed lamp");
    const empty = await browseWith([closed]);
    expect(empty).toContain("cc-empty");
    expect(empty).toContain("There are no listings right now");
  });

  it("AC: noindex is output on a listing page and the browse page, and nowhere else", async () => {
    const meta = '<meta name="robots" content="noindex, nofollow">';
    const listing = await render("noindex", {
      request: { page_type: "metaobject" },
      metaobject: openEntry(),
    });
    const browse = await render("noindex", {
      request: { page_type: "page" },
      page: { handle: "classifieds" },
    });
    const other = await render("noindex", {
      request: { page_type: "page" },
      page: { handle: "about" },
    });
    expect(listing).toContain(meta);
    expect(browse).toContain(meta);
    expect(other.trim()).toBe("");
  });

  it.each([
    "http://photos.example.test/public/a/0_large.jpg",
    "javascript:alert(1)//_large.jpg",
  ])("SEC: the image %s is not rendered", async (url) => {
    const html = await render("img", { url, alt: "x", sizes: "100vw", lazy: true });
    expect(html.trim()).toBe("");
  });

  it("AC: the header button is hidden at 0 live listings", async () => {
    for (const value of ["0", null]) {
      const html = await render("header", {
        shop: { metafields: { classifieds: { live_count: { value } } } },
      });
      expect(html.trim()).toBe("");
    }
  });

  it("AC: the header button links to the browse page at 3 live listings", async () => {
    const html = await render("header", {
      shop: { metafields: { classifieds: { live_count: { value: "3" } } } },
    });
    expect(html).toContain('href="/pages/classifieds"');
    expect(html).toContain("cc-header-button");
  });
});
