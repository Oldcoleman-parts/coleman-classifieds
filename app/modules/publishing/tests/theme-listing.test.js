import { describe, expect, it } from "vitest";
import { closedFields } from "@/modules/publishing/services/fields.js";
import { entryOf, OPEN_LISTING, openEntry, render } from "./theme-render.js";

const XSS = "<script>alert(1)</script>";
const ESCAPED = "&lt;script&gt;alert(1)&lt;/script&gt;";

describe("Listing page block (F06-T2)", () => {
  it.each([
    ["the title", { title: XSS }],
    ["the description", { description: XSS }],
    ["the seller name", { sellerDisplay: XSS }],
  ])("SEC: a script tag in %s renders as text", async (_what, change) => {
    const html = await render("listing", {
      metaobject: openEntry(change),
    });
    expect(html).toContain(ESCAPED);
    expect(html).not.toContain("<script");
  });

  it("AC: an open listing shows the badge, first name only, location, price, disclaimer and the contact slot", async () => {
    const html = await render("listing", { metaobject: openEntry() });
    expect(html).toContain("Private seller listing");
    expect(html).toContain("Wichita, KS");
    expect(html).toContain("$25.00");
    expect(html).toContain("Old Coleman Parts does not own");
    expect(html).toContain("Sam");
    expect(html).not.toContain("Sam Seller");
    expect(html).toContain(`data-listing-ref="${OPEN_LISTING.id}"`);
  });

  it("AC: a closed listing shows only 'no longer available', with no seller, description or cart form", async () => {
    const closed = entryOf(closedFields({ ...OPEN_LISTING, status: "SOLD" }));
    const html = await render("listing", {
      metaobject: {
        ...closed,
        description: { value: "Secret mantle note" },
        seller_display: { value: "Gwendolyn" },
      },
    });
    expect(html).toContain("This listing is no longer available");
    expect(html).not.toContain("Secret mantle note");
    expect(html).not.toContain("Gwendolyn");
    expect(html).not.toMatch(/<form|add to cart|cart/i);
  });

  it("SEC: an open listing has no form or cart markup", async () => {
    const html = await render("listing", { metaobject: openEntry() });
    expect(html).not.toMatch(/<form|add to cart|cart/i);
  });
});

describe("Contact link (F07-T1)", () => {
  it("AC: an open listing links to its contact form", async () => {
    const html = await render("listing", { metaobject: openEntry() });
    expect(html).toContain(
      'href="/apps/classifieds/contact/lantern-abc123"',
    );
    expect(html).toContain("Contact the seller");
  });

  it("AC: a closed listing has no contact link", async () => {
    const closed = entryOf(closedFields({ ...OPEN_LISTING, status: "SOLD" }));
    const html = await render("listing", { metaobject: closed });
    expect(html).not.toContain("/apps/classifieds/contact/");
    expect(html).not.toContain("Contact the seller");
  });
});
