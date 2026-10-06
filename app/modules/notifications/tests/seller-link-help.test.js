import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { asStaff } from "@/../tests/factories.js";
import {
  getTemplate,
  previewTemplate,
  saveTemplate,
  getEmailSettings,
} from "@/modules/notifications/index.js";
import {
  renderEmail,
  cleanTemplate,
  cleanVars,
} from "@/modules/notifications/services/render.js";
import { loadEmailsScreen } from "@/modules/notifications/services/screens.js";
import { GET_LINK_PATH } from "@/modules/notifications/registry.js";
import { SUPERSEDED_DEFAULTS } from "@/../emails/superseded.js";
import { EMAIL_DEFAULTS } from "@/../emails/defaults.js";

describe("F03-T4: Seller link help in emails (AC + SEC)", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
    process.env.OCP_POSTAL_ADDRESS = "123 Main St, Spokane WA";
    process.env.SHOP_DOMAIN = "ocp-dev.myshopify.com";
    process.env.SHOPIFY_API_KEY = "test-key";
  });

  afterEach(() => {
    delete process.env.OCP_POSTAL_ADDRESS;
    delete process.env.SHOP_DOMAIN;
    delete process.env.SHOPIFY_API_KEY;
  });

  const staff = asStaff();
  const staffActor = { type: "STAFF", ref: staff.session.email };

  // AC1: changes_requested and draft_reminder without/with seller_link
  describe("AC1: seller_link optional on changes_requested and draft_reminder", () => {
    it("AC1: changes_requested renders without seller_link, fallback text shown", async () => {
      const key = "changes_requested";
      const template = await getTemplate(key);
      const vars = cleanVars(key, {
        seller_first_name: "Pat",
        listing_title: "1962 Coleman 200A lantern",
        staff_note: "Please add a photo",
        correction_due_date: "October 19, 2026",
      });
      const { html, text } = await renderEmail(
        key,
        template,
        vars,
        await getEmailSettings(),
      );

      expect(html).not.toContain('href=""');
      expect(html).toContain("link from your invitation email");
      expect(text).toContain("link from your invitation email");
    });

    it("AC1: changes_requested renders with seller_link, link shown", async () => {
      const key = "changes_requested";
      const template = await getTemplate(key);
      const linkUrl = "https://oldcolemanparts.com/apps/classifieds/i/sample";
      const vars = cleanVars(key, {
        seller_first_name: "Pat",
        listing_title: "1962 Coleman 200A lantern",
        staff_note: "Please add a photo",
        correction_due_date: "October 19, 2026",
        seller_link: linkUrl,
      });
      const { html, text } = await renderEmail(
        key,
        template,
        vars,
        await getEmailSettings(),
      );

      expect(html).toContain(`href="${linkUrl}"`);
      expect(html).not.toContain("link from your invitation email");
      expect(text).toContain(linkUrl);
      expect(text).not.toContain("link from your invitation email");
    });

    it("AC1: draft_reminder renders without seller_link, fallback text shown", async () => {
      const key = "draft_reminder";
      const template = await getTemplate(key);
      const vars = cleanVars(key, {
        seller_first_name: "Pat",
        draft_due_date: "October 19, 2026",
      });
      const { html, text } = await renderEmail(
        key,
        template,
        vars,
        await getEmailSettings(),
      );

      expect(html).not.toContain('href=""');
      expect(html).toContain("link from your invitation email");
      expect(text).toContain("link from your invitation email");
    });

    it("AC1: draft_reminder renders with seller_link, link shown", async () => {
      const key = "draft_reminder";
      const template = await getTemplate(key);
      const linkUrl = "https://oldcolemanparts.com/apps/classifieds/i/sample";
      const vars = cleanVars(key, {
        seller_first_name: "Pat",
        draft_due_date: "October 19, 2026",
        seller_link: linkUrl,
      });
      const { html } = await renderEmail(
        key,
        template,
        vars,
        await getEmailSettings(),
      );

      expect(html).toContain(`href="${linkUrl}"`);
      expect(html).not.toContain("link from your invitation email");
    });

    it("AC1: cleanTemplate accepts changes_requested without seller_link", async () => {
      const key = "changes_requested";
      const template = await getTemplate(key);
      const result = await cleanTemplate(key, {
        subject: template.subject,
        bodyHtml: template.bodyHtml.replace("{{ seller_link }}", ""),
      });
      expect(result.subject).toBeTruthy();
      expect(result.bodyHtml).toBeTruthy();
    });

    it("AC1: cleanTemplate refuses changes_requested without required staff_note", async () => {
      const key = "changes_requested";
      await expect(
        cleanTemplate(key, {
          subject: "Test",
          bodyHtml: "<p>Hello</p>",
        }),
      ).rejects.toThrow(/staff_note/);
    });
  });

  // AC2: seller_link_request with different counts and escaping
  describe("AC2: seller_link_request with listing counts and escaping", () => {
    it("AC2: seller_link_request with 1 listing shows 1 link", async () => {
      const key = "seller_link_request";
      const template = await getTemplate(key);
      const vars = cleanVars(key, {
        seller_first_name: "Pat",
        listings: [
          {
            title: "1962 Coleman 200A lantern",
            status: "LIVE",
            date: "November 5, 2026",
            seller_link:
              "https://oldcolemanparts.com/apps/classifieds/i/sample",
          },
        ],
      });
      const { html } = await renderEmail(
        key,
        template,
        vars,
        await getEmailSettings(),
      );

      const linkMatches = html.match(
        /href="https:\/\/oldcolemanparts\.com\/apps\/classifieds\/i\/sample"/g,
      );
      expect(linkMatches).toHaveLength(1);
      expect(html).not.toContain("more open listings");
    });

    it("AC2: seller_link_request with 3 listings shows 3 links", async () => {
      const key = "seller_link_request";
      const template = await getTemplate(key);
      const vars = cleanVars(key, {
        seller_first_name: "Pat",
        listings: [
          {
            title: "Lantern 1",
            status: "LIVE",
            date: "November 5, 2026",
            seller_link: "https://oldcolemanparts.com/apps/classifieds/i/1",
          },
          {
            title: "Stove 1",
            status: "DRAFT",
            date: "October 19, 2026",
            seller_link: "https://oldcolemanparts.com/apps/classifieds/i/2",
          },
          {
            title: "Cooker 1",
            status: "APPROVED_AWAITING_PAYMENT",
            date: "October 20, 2026",
            seller_link: "https://oldcolemanparts.com/apps/classifieds/i/3",
          },
        ],
      });
      const { html } = await renderEmail(
        key,
        template,
        vars,
        await getEmailSettings(),
      );

      expect(html).toContain("Lantern 1");
      expect(html).toContain("Stove 1");
      expect(html).toContain("Cooker 1");
      expect(html).not.toContain("more open listings");
    });

    it("AC2: seller_link_request with 21 listings shows 20 plus more_count", async () => {
      const key = "seller_link_request";
      const template = await getTemplate(key);
      const listings = Array.from({ length: 21 }, (_, i) => ({
        title: `Item ${i + 1}`,
        status: "LIVE",
        date: "November 5, 2026",
        seller_link: `https://oldcolemanparts.com/apps/classifieds/i/${i + 1}`,
      }));
      const vars = cleanVars(key, {
        seller_first_name: "Pat",
        listings,
      });

      expect(vars.more_count).toBe(1);
      expect(vars.listings).toHaveLength(20);

      const { html } = await renderEmail(
        key,
        template,
        vars,
        await getEmailSettings(),
      );

      expect(html).toContain("1 more open listings");
    });

    it("AC2: seller_link_request title is escaped", async () => {
      const key = "seller_link_request";
      const template = await getTemplate(key);
      const vars = cleanVars(key, {
        seller_first_name: "Pat",
        listings: [
          {
            title: '<script>&"x</script>',
            status: "LIVE",
            date: "November 5, 2026",
            seller_link: "https://oldcolemanparts.com/apps/classifieds/i/1",
          },
        ],
      });
      const { html, text } = await renderEmail(
        key,
        template,
        vars,
        await getEmailSettings(),
      );

      // The HTML should not contain actual unescaped script tags
      expect(html).not.toContain("<script>alert");
      expect(html).not.toContain("<script onerror");
      // The escaped text should be in the HTML
      expect(html).toContain("&lt;");
      // The plain text should contain the title (possibly unescaped in text)
      expect(text).toBeTruthy();
    });

    it("AC2: seller_link_request empty listings array is rejected", async () => {
      const key = "seller_link_request";
      expect(() =>
        cleanVars(key, { seller_first_name: "Pat", listings: [] }),
      ).toThrow(/listings.*required/);
    });

    it("AC2: seller_link_request unknown field in listing is rejected", async () => {
      const key = "seller_link_request";
      expect(() =>
        cleanVars(key, {
          seller_first_name: "Pat",
          listings: [
            {
              title: "Item 1",
              status: "LIVE",
              date: "November 5, 2026",
              seller_link: "https://oldcolemanparts.com/apps/classifieds/i/1",
              unknown_field: "bad",
            },
          ],
        }),
      ).toThrow(/listings.*not valid/);
    });

    it("AC2: saveTemplate refuses seller_link_request body without for loop", async () => {
      const key = "seller_link_request";
      const template = await getTemplate(key);
      await expect(
        saveTemplate(
          key,
          {
            subject: template.subject,
            bodyHtml: "<p>No loop here</p>",
          },
          staffActor,
        ),
      ).rejects.toThrow(/listings/);
    });

    it("AC2: seller_link_request shows status words correctly", async () => {
      const key = "seller_link_request";
      const template = await getTemplate(key);
      const vars = cleanVars(key, {
        seller_first_name: "Pat",
        listings: [
          {
            title: "Live Item",
            status: "LIVE",
            date: "November 5, 2026",
            seller_link: "https://oldcolemanparts.com/apps/classifieds/i/1",
          },
          {
            title: "Draft Item",
            status: "DRAFT",
            date: "October 19, 2026",
            seller_link: "https://oldcolemanparts.com/apps/classifieds/i/2",
          },
        ],
      });
      const { html } = await renderEmail(
        key,
        template,
        vars,
        await getEmailSettings(),
      );

      expect(html).toContain("Live until November 5, 2026");
      expect(html).toContain("Draft, finish by October 19, 2026");
    });
  });

  // AC3: help line with get_link_url validation
  describe("AC3: help line shown with valid get_link_url", () => {
    it.each([
      "changes_requested",
      "draft_reminder",
      "listing_live",
      "expiry_reminder",
      "revision_rejected",
    ])("AC3: %s shows help line with valid get_link_url", async (key) => {
      const template = await getTemplate(key);
      const getLinkUrl = `https://oldcolemanparts.com${GET_LINK_PATH}`;
      const vars = cleanVars(key, {
        ...(key === "changes_requested" && {
          seller_first_name: "Pat",
          listing_title: "Item",
          staff_note: "Changes needed",
          correction_due_date: "October 19, 2026",
        }),
        ...(key === "draft_reminder" && {
          seller_first_name: "Pat",
          draft_due_date: "October 19, 2026",
        }),
        ...(key === "listing_live" && {
          seller_first_name: "Pat",
          listing_title: "Item",
          expires_date: "November 5, 2026",
          listing_url: "https://oldcolemanparts.com/pages/classifieds/item",
        }),
        ...(key === "expiry_reminder" && {
          seller_first_name: "Pat",
          listing_title: "Item",
          expires_date: "November 5, 2026",
        }),
        ...(key === "revision_rejected" && {
          seller_first_name: "Pat",
          listing_title: "Item",
        }),
        get_link_url: getLinkUrl,
      });
      const { html } = await renderEmail(
        key,
        template,
        vars,
        await getEmailSettings(),
      );

      expect(html).toContain("Can't find your private link? Get it here:");
      expect(html).toContain(`href="${getLinkUrl}"`);
    });

    it("AC3: help line absent when get_link_url not provided", async () => {
      const key = "changes_requested";
      const template = await getTemplate(key);
      const vars = cleanVars(key, {
        seller_first_name: "Pat",
        listing_title: "Item",
        staff_note: "Changes needed",
        correction_due_date: "October 19, 2026",
      });
      const { html } = await renderEmail(
        key,
        template,
        vars,
        await getEmailSettings(),
      );

      expect(html).not.toContain("Can't find your private link?");
    });

    it("AC3: get_link_url with query string is rejected", async () => {
      const key = "changes_requested";
      expect(() =>
        cleanVars(key, {
          seller_first_name: "Pat",
          listing_title: "Item",
          staff_note: "Changes needed",
          correction_due_date: "October 19, 2026",
          get_link_url: `https://oldcolemanparts.com${GET_LINK_PATH}?t=abc`,
        }),
      ).toThrow(/get_link_url.*Get my link page/);
    });

    it("AC3: get_link_url with fragment is rejected", async () => {
      const key = "changes_requested";
      expect(() =>
        cleanVars(key, {
          seller_first_name: "Pat",
          listing_title: "Item",
          staff_note: "Changes needed",
          correction_due_date: "October 19, 2026",
          get_link_url: `https://oldcolemanparts.com${GET_LINK_PATH}#x`,
        }),
      ).toThrow(/get_link_url.*Get my link page/);
    });

    it("AC3: get_link_url with wrong path is rejected", async () => {
      const key = "changes_requested";
      expect(() =>
        cleanVars(key, {
          seller_first_name: "Pat",
          listing_title: "Item",
          staff_note: "Changes needed",
          correction_due_date: "October 19, 2026",
          get_link_url: "https://oldcolemanparts.com/apps/classifieds/i/abc",
        }),
      ).toThrow(/get_link_url.*Get my link page/);
    });

    it("AC3: get_link_url with http scheme is rejected", async () => {
      const key = "changes_requested";
      expect(() =>
        cleanVars(key, {
          seller_first_name: "Pat",
          listing_title: "Item",
          staff_note: "Changes needed",
          correction_due_date: "October 19, 2026",
          get_link_url: `http://oldcolemanparts.com${GET_LINK_PATH}`,
        }),
      ).toThrow(/get_link_url.*https/);
    });

    it("SEC: help line never contains seller_link value", async () => {
      const key = "changes_requested";
      const template = await getTemplate(key);
      const sellerLink =
        "https://oldcolemanparts.com/apps/classifieds/i/secret";
      const getLinkUrl = `https://oldcolemanparts.com${GET_LINK_PATH}`;
      const vars = cleanVars(key, {
        seller_first_name: "Pat",
        listing_title: "Item",
        staff_note: "Changes needed",
        correction_due_date: "October 19, 2026",
        seller_link: sellerLink,
        get_link_url: getLinkUrl,
      });
      const { html } = await renderEmail(
        key,
        template,
        vars,
        await getEmailSettings(),
      );

      const helpLineStart = html.indexOf("Can't find your private link?");
      const helpLineEnd = html.indexOf("</p>", helpLineStart);
      const helpLine = html.substring(helpLineStart, helpLineEnd);

      expect(helpLine).not.toContain(sellerLink);
      expect(helpLine).toContain(getLinkUrl);
    });
  });

  // Stored customised template still works
  describe("Stored customised templates", () => {
    it("Stored customised changes_requested with old placeholders renders", async () => {
      const key = "changes_requested";
      // Save a custom template that uses old placeholders without get_link_url
      const customBody = `<p>Hi {{ seller_first_name }},</p>
<p>Please update: {{ staff_note }}</p>
{% if seller_link != "" %}<p><a href="{{ seller_link }}">Update</a></p>{% else %}<p>Use your invitation link.</p>{% endif %}
<p>Done by {{ correction_due_date }}.</p>`;
      await saveTemplate(
        key,
        {
          subject: "Custom: {{ listing_title }}",
          bodyHtml: customBody,
        },
        staffActor,
      );

      // Render it with vars lacking get_link_url
      const template = await getTemplate(key);
      const vars = cleanVars(key, {
        seller_first_name: "Pat",
        listing_title: "Item",
        staff_note: "Add photos",
        correction_due_date: "October 19, 2026",
        seller_link: "https://oldcolemanparts.com/apps/classifieds/i/sample",
      });
      const { html } = await renderEmail(
        key,
        template,
        vars,
        await getEmailSettings(),
      );

      expect(html).toContain("Update");
      expect(html).not.toContain("Can't find your private link?");
    });
  });

  // Default upgrade
  describe("Default upgrade from SUPERSEDED_DEFAULTS", () => {
    it("Default upgrade: SUPERSEDED_DEFAULTS moved to current default", async () => {
      // Use a key that has a superseded default
      const key = "draft_reminder";
      const superseded = SUPERSEDED_DEFAULTS[key];
      if (!superseded || superseded.length === 0) {
        throw new Error("draft_reminder should have a superseded default");
      }
      const old = superseded[0];

      // Ensure the template exists first
      await getTemplate(key);

      // Manually update it to the old default
      await prisma.emailTemplate.update({
        where: { key },
        data: {
          subject: old.subject,
          bodyHtml: old.bodyHtml,
          version: 1,
          updatedBy: null,
        },
      });

      // Call getTemplate to trigger upgrade
      const template = await getTemplate(key);

      expect(template.subject).toBe(EMAIL_DEFAULTS[key].subject);
      expect(template.bodyHtml).toBe(EMAIL_DEFAULTS[key].bodyHtml);
      expect(template.version).toBe(2);
      expect(template.updatedBy).toBeNull();

      const audit = await prisma.auditEvent.findFirst({
        where: { action: "EmailTemplateDefaultsUpdated" },
      });
      expect(audit).toBeDefined();
      expect(audit.details.key).toBe(key);
      expect(audit.details.version).toBe(2);
    });

    it("Default upgrade: customised template stays unchanged", async () => {
      const key = "changes_requested";
      const customBody = "<p>Custom: {{ listing_title }} {{ staff_note }}</p>";
      await saveTemplate(
        key,
        {
          subject: "Custom subject",
          bodyHtml: customBody,
        },
        staffActor,
      );
      const saved = await getTemplate(key);

      // Call getTemplate again
      const again = await getTemplate(key);

      expect(again.subject).toBe(saved.subject);
      expect(again.bodyHtml).toBe(saved.bodyHtml);
      expect(again.version).toBe(saved.version);

      const auditCount = await prisma.auditEvent.count({
        where: { action: "EmailTemplateDefaultsUpdated" },
      });
      expect(auditCount).toBe(0);
    });
  });

  // Screens
  describe("Screens: seller_link_request listed and preview", () => {
    it("seller_link_request listed in seller group", async () => {
      const screen = await loadEmailsScreen();
      const sellerGroup = screen.groups.find((g) => g.audience === "seller");
      const template = sellerGroup.templates.find(
        (t) => t.key === "seller_link_request",
      );

      expect(template).toBeDefined();
      expect(template.label).toBe("Your private links");
    });

    it("previewTemplate renders seller_link_request with sample data", async () => {
      const preview = await previewTemplate("seller_link_request");

      expect(preview.subject).toContain("Coleman Classifieds links");
      expect(preview.html).toContain("1962 Coleman 200A lantern");
      expect(preview.html).toContain("Coleman 413 stove");
      expect(preview.html).toContain("Open this listing");
      expect(preview.text).toBeTruthy();
    });
  });

  // Security tests
  describe("SEC: security boundaries", () => {
    it("SEC: seller_link_request caller more_count overwritten", async () => {
      const key = "seller_link_request";
      const vars = cleanVars(key, {
        seller_first_name: "Pat",
        listings: [
          {
            title: "Item 1",
            status: "LIVE",
            date: "November 5, 2026",
            seller_link: "https://oldcolemanparts.com/apps/classifieds/i/1",
          },
          {
            title: "Item 2",
            status: "LIVE",
            date: "November 5, 2026",
            seller_link: "https://oldcolemanparts.com/apps/classifieds/i/2",
          },
        ],
        more_count: "999",
      });

      // more_count should be overwritten by cleanVars (it's empty for 2 items)
      expect(vars.more_count).toBe("");
    });

    it("SEC: seller_link can have any https URL, but get_link_url path is strictly validated", async () => {
      const key = "changes_requested";

      // seller_link can have any https URL
      const result1 = cleanVars(key, {
        seller_first_name: "Pat",
        listing_title: "Item",
        staff_note: "Changes needed",
        correction_due_date: "October 19, 2026",
        seller_link: `https://example.com/apps/classifieds/my-link`,
      });
      expect(result1.seller_link).toBeTruthy();

      // get_link_url validates the path regardless of domain
      const result2 = cleanVars(key, {
        seller_first_name: "Pat",
        listing_title: "Item",
        staff_note: "Changes needed",
        correction_due_date: "October 19, 2026",
        get_link_url: `https://other.com${GET_LINK_PATH}`,
      });
      expect(result2.get_link_url).toBeTruthy();

      // But wrong path is refused
      expect(() =>
        cleanVars(key, {
          seller_first_name: "Pat",
          listing_title: "Item",
          staff_note: "Changes needed",
          correction_due_date: "October 19, 2026",
          get_link_url: "https://oldcolemanparts.com/apps/classifieds/wrong",
        }),
      ).toThrow(/get_link_url/);
    });

    it("SEC: unknown email key is rejected", async () => {
      expect(() => cleanVars("unknown_key", {})).toThrow(/Unknown email/);
    });

    it("SEC: seller_link_request requires listings field", async () => {
      const key = "seller_link_request";
      expect(() =>
        cleanVars(key, {
          seller_first_name: "Pat",
        }),
      ).toThrow(/listings.*required/);
    });
  });
});
