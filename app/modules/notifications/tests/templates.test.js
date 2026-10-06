import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { asStaff } from "@/../tests/factories.js";
import {
  TEMPLATE_KEYS,
  getTemplate,
  previewTemplate,
  resetTemplate,
  saveTemplate,
} from "@/modules/notifications/index.js";

describe("Email templates (AC + SEC)", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
    process.env.OCP_POSTAL_ADDRESS = "123 Main St, Spokane WA";
  });

  afterEach(() => {
    delete process.env.OCP_POSTAL_ADDRESS;
  });

  const staff = asStaff();
  const staffActor = { type: "STAFF", ref: staff.session.email };

  it.each(TEMPLATE_KEYS)(
    "AC: template %s previews with sample data",
    async (key) => {
      const preview = await previewTemplate(key);
      expect(preview.subject).toBeTruthy();
      expect(preview.subject.length > 0).toBe(true);
      expect(preview.html).toBeTruthy();
      expect(preview.text).toBeTruthy();
    },
  );

  it("AC: template edit bumps version, sets updatedBy, and audits", async () => {
    const key = "staff_review_needed";
    const original = await getTemplate(key);

    const { template, changed } = await saveTemplate(
      key,
      { subject: "Updated: {{ listing_title }}", bodyHtml: original.bodyHtml },
      staffActor,
    );

    expect(changed).toBe(true);
    expect(template.version).toBe(2);
    expect(template.updatedBy).toBe(staff.session.email);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "EmailTemplateUpdated" },
    });
    expect(audit).toBeDefined();
    expect(audit.details.key).toBe(key);
    expect(audit.actorRef).toBe(staff.session.email);
  });

  it("AC: saving same content doesn't bump version", async () => {
    const key = "alerts_confirm";
    const template1 = await getTemplate(key);

    const { changed, template: template2 } = await saveTemplate(
      key,
      { subject: template1.subject, bodyHtml: template1.bodyHtml },
      staffActor,
    );

    expect(changed).toBe(false);
    expect(template2.version).toBe(template1.version);
  });

  it("AC: removing required placeholder is blocked", async () => {
    const key = "staff_review_needed";
    const template = await getTemplate(key);

    await expect(
      saveTemplate(
        key,
        { subject: template.subject, bodyHtml: "<p>Hello</p>" },
        staffActor,
      ),
    ).rejects.toThrow(/review_link/);
  });

  it("AC: reset restores default and audits", async () => {
    const key = "staff_review_needed";
    const original = await getTemplate(key);
    const newBody = "<p>{{ listing_title }} {{ review_link }}</p>";

    await saveTemplate(
      key,
      { subject: "Change", bodyHtml: newBody },
      staffActor,
    );

    const { template, changed } = await resetTemplate(key, staffActor);

    expect(changed).toBe(true);
    expect(template.bodyHtml).toBe(original.bodyHtml);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "EmailTemplateReset" },
    });
    expect(audit).toBeDefined();
    expect(audit.details.key).toBe(key);
  });

  it("SEC: XSS payload in template is sanitised", async () => {
    const key = "staff_review_needed";
    await getTemplate(key);
    const malicious =
      "<p>{{ listing_title }} <script>alert('xss')</script> {{ review_link }}</p>";

    const { template: saved } = await saveTemplate(
      key,
      { subject: "Test", bodyHtml: malicious },
      staffActor,
    );

    expect(saved.bodyHtml).not.toContain("<script>");
  });

  it("SEC: onclick in template is sanitised", async () => {
    const key = "staff_review_needed";
    await getTemplate(key);
    const malicious =
      '<p onclick="alert(1)" >{{ listing_title }} {{ review_link }}</p>';

    const { template: saved } = await saveTemplate(
      key,
      { subject: "Test", bodyHtml: malicious },
      staffActor,
    );

    expect(saved.bodyHtml).not.toContain("onclick");
  });

  it("SEC: javascript: href in template is sanitised", async () => {
    const key = "staff_review_needed";
    await getTemplate(key);
    const malicious =
      '<a href="javascript:alert(1)">{{ listing_title }} {{ review_link }}</a>';

    const { template: saved } = await saveTemplate(
      key,
      { subject: "Test", bodyHtml: malicious },
      staffActor,
    );

    expect(saved.bodyHtml).not.toContain("javascript:");
  });

  it("SEC: unknown placeholder is refused", async () => {
    const key = "staff_review_needed";
    const template = await getTemplate(key);

    await expect(
      saveTemplate(
        key,
        {
          subject: template.subject,
          bodyHtml: "<p>{{ unknown_placeholder }} {{ review_link }}</p>",
        },
        staffActor,
      ),
    ).rejects.toThrow(/unknown_placeholder/);
  });

  it("SEC: filter like upcase is refused", async () => {
    const key = "staff_review_needed";
    const template = await getTemplate(key);

    await expect(
      saveTemplate(
        key,
        {
          subject: template.subject,
          bodyHtml: "<p>{{ listing_title | upcase }} {{ review_link }}</p>",
        },
        staffActor,
      ),
    ).rejects.toThrow();
  });

  it("SEC: include tag is refused", async () => {
    const key = "staff_review_needed";
    const template = await getTemplate(key);

    await expect(
      saveTemplate(
        key,
        {
          subject: template.subject,
          bodyHtml: "{% include 'other' %} {{ review_link }}",
        },
        staffActor,
      ),
    ).rejects.toThrow();
  });

  it("SEC: unclosed if is refused", async () => {
    const key = "staff_review_needed";
    const template = await getTemplate(key);

    await expect(
      saveTemplate(
        key,
        {
          subject: template.subject,
          bodyHtml: "{% if true %}<p>{{ review_link }}</p>",
        },
        staffActor,
      ),
    ).rejects.toThrow();
  });

  it("SEC: SELLER actor cannot save template", async () => {
    const sellerActor = { type: "SELLER" };
    const key = "staff_review_needed";
    const template = await getTemplate(key);

    await expect(
      saveTemplate(
        key,
        { subject: template.subject, bodyHtml: template.bodyHtml },
        sellerActor,
      ),
    ).rejects.toThrow();
  });

  it("SEC: SELLER actor cannot reset template", async () => {
    const sellerActor = { type: "SELLER" };

    await expect(
      resetTemplate("staff_review_needed", sellerActor),
    ).rejects.toThrow();
  });
});

describe("SEC: a placeholder value can't inject HTML", () => {
  it("escapes HTML in a value", async () => {
    await resetDb();
    const { getEmailSettings } =
      await import("@/modules/notifications/index.js");
    const { renderEmail } =
      await import("@/modules/notifications/services/render.js");
    const { html } = await renderEmail(
      "staff_review_needed",
      await getTemplate("staff_review_needed"),
      {
        listing_title: '<script>alert(1)</script><img src=x onerror="y">',
        change_type: "edit",
        review_link: "https://shop.example.test/app/listings/1",
      },
      await getEmailSettings(),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });
});
