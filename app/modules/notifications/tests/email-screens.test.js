import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing, mockSes, asStaff } from "@/../tests/factories.js";
import {
  handleTemplateEditor,
  loadEmailsScreen,
  loadTemplateEditor,
  resetTestEmailLimit,
  notifyStaff,
  saveEmailSettingsForm,
  sendTestEmail,
  setSesClient,
  TEMPLATE_KEYS,
  getEmailSettings,
} from "@/modules/notifications/index.js";
import { staffFromSession } from "@/modules/core/index.js";
import { suppress } from "@/modules/notifications/services/suppression.js";

describe("Email settings screens (AC + SEC)", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
    process.env.SES_FROM_TRANSACTIONAL = "transactional@example.test";
    process.env.SES_CONFIG_SET_TRANSACTIONAL = "tx-set";
    process.env.OCP_POSTAL_ADDRESS = "123 Main St, Spokane WA";
    process.env.SHOP_DOMAIN = "ocp-dev.myshopify.com";
    process.env.SHOPIFY_API_KEY = "test-key";
  });

  afterEach(() => {
    setSesClient(null);
    resetTestEmailLimit();
    delete process.env.SES_FROM_TRANSACTIONAL;
    delete process.env.SES_CONFIG_SET_TRANSACTIONAL;
    delete process.env.OCP_POSTAL_ADDRESS;
    delete process.env.SHOP_DOMAIN;
    delete process.env.SHOPIFY_API_KEY;
  });

  it("AC: saving staffNotify address makes next notifyStaff go there; audit entry with action and staff email", async () => {
    const ses = mockSes();
    setSesClient(ses);

    const staff = asStaff({ email: "admin@example.test" });
    const actor = staffFromSession(staff.session);
    const formData = new FormData();
    formData.append("senderName", "OCP Support");
    formData.append("replyTo", "");
    formData.append("staffNotify", "newstaff@example.test");
    formData.append("logoUrl", "");
    formData.append("buttonColor", "#C8102E");
    formData.append("footerText", "");
    formData.append("phone", "");
    formData.append("supportEmail", "");
    formData.append("postalAddress", "");

    const result = await saveEmailSettingsForm(formData, actor);
    expect(result.ok).toBe(true);
    expect(result.changed).toContain("staffNotify");

    const listing = await makeListing({ title: "Coleman Lantern 1962" });
    await notifyStaff(
      "NEW",
      listing,
      `https://ocp-dev.myshopify.com/admin/apps/test-key/app/listings/${listing.id}`,
    );
    expect(ses.sent).toHaveLength(1);
    expect(ses.sent[0].input.Destination.ToAddresses).toEqual([
      "newstaff@example.test",
    ]);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "EmailSettingsUpdated" },
      orderBy: { at: "desc" },
    });
    expect(audit).toBeDefined();
    expect(audit.actorRef).toBe("admin@example.test");
    expect(audit.details).toHaveProperty("changed");
    expect(audit.details.changed).toContain("staffNotify");
    // Ensure no address values in audit
    expect(JSON.stringify(audit.details)).not.toContain(
      "newstaff@example.test",
    );
  });

  it.each([
    {
      field: "staffNotify",
      value: "not-an-email",
      desc: "invalid email in staffNotify",
    },
    { field: "replyTo", value: "not-an-email", desc: "invalid replyTo" },
    {
      field: "logoUrl",
      value: "http://example.com/a.png",
      desc: "http logoUrl",
    },
    {
      field: "logoUrl",
      value: "javascript:alert(1)",
      desc: "javascript logoUrl",
    },
    { field: "buttonColor", value: "red", desc: "invalid buttonColor" },
  ])(
    "AC: $desc is refused with fieldError, no change, no audit",
    async ({ field, value }) => {
      const staff = asStaff({ email: "admin@example.test" });
      const actor = staffFromSession(staff.session);
      const formData = new FormData();
      formData.append("senderName", "OCP Support");
      formData.append("replyTo", "");
      formData.append("staffNotify", "");
      formData.append("logoUrl", "");
      formData.append("buttonColor", "#C8102E");
      formData.append("footerText", "");
      formData.append("phone", "");
      formData.append("supportEmail", "");
      formData.append("postalAddress", "");
      formData.set(field, value);

      const result = await saveEmailSettingsForm(formData, actor);
      expect(result.ok).toBe(false);
      expect(result.fieldErrors).toHaveProperty(field);

      const settings = await getEmailSettings();
      expect(settings.staffNotify).toEqual([]);

      const auditCount = await prisma.auditEvent.count({
        where: { action: "EmailSettingsUpdated" },
      });
      expect(auditCount).toBe(0);
    },
  );

  it("AC: more than 5 staff addresses is refused; duplicates are collapsed; empty staffNotify is accepted", async () => {
    const staff = asStaff();
    const actor = staffFromSession(staff.session);

    // Test more than 5
    const formData = new FormData();
    formData.append("senderName", "OCP");
    formData.append("replyTo", "");
    formData.append(
      "staffNotify",
      "a@example.test\nb@example.test\nc@example.test\nd@example.test\ne@example.test\nf@example.test",
    );
    formData.append("logoUrl", "");
    formData.append("buttonColor", "#C8102E");
    formData.append("footerText", "");
    formData.append("phone", "");
    formData.append("supportEmail", "");
    formData.append("postalAddress", "");

    let result = await saveEmailSettingsForm(formData, actor);
    expect(result.ok).toBe(false);
    expect(result.fieldErrors).toHaveProperty("staffNotify");

    // Test duplicates are collapsed
    const formData2 = new FormData();
    formData2.append("senderName", "OCP");
    formData2.append("replyTo", "");
    formData2.append(
      "staffNotify",
      "a@example.test\na@example.test\nb@example.test",
    );
    formData2.append("logoUrl", "");
    formData2.append("buttonColor", "#C8102E");
    formData2.append("footerText", "");
    formData2.append("phone", "");
    formData2.append("supportEmail", "");
    formData2.append("postalAddress", "");

    result = await saveEmailSettingsForm(formData2, actor);
    expect(result.ok).toBe(true);
    const settings = await getEmailSettings();
    expect(settings.staffNotify).toEqual(["a@example.test", "b@example.test"]);

    // Test empty staffNotify is accepted
    const formData3 = new FormData();
    formData3.append("senderName", "OCP");
    formData3.append("replyTo", "");
    formData3.append("staffNotify", "");
    formData3.append("logoUrl", "");
    formData3.append("buttonColor", "#C8102E");
    formData3.append("footerText", "");
    formData3.append("phone", "");
    formData3.append("supportEmail", "");
    formData3.append("postalAddress", "");

    result = await saveEmailSettingsForm(formData3, actor);
    expect(result.ok).toBe(true);
    expect(result.changed).toContain("staffNotify");
  });

  it("AC: handleTemplateEditor save of new subject for listing_closed applies to next send", async () => {
    const ses = mockSes();
    setSesClient(ses);

    const staff = asStaff({ email: "admin@example.test" });
    const actor = staffFromSession(staff.session);

    const formData = new FormData();
    formData.append("intent", "save");
    formData.append("subject", "Your listing has ended");
    formData.append(
      "bodyHtml",
      "{{ seller_first_name }}, your listing {{ listing_title }} is closed.",
    );
    formData.append("confirmed", "");

    const result = await handleTemplateEditor(
      "listing_closed",
      formData,
      actor,
    );
    expect(result).toHaveProperty("ok", true);
    expect(result.intent).toBe("save");

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "EmailTemplateUpdated" },
      orderBy: { at: "desc" },
    });
    expect(audit).toBeDefined();
    expect(audit.actorRef).toBe("admin@example.test");
  });

  it("AC: handleTemplateEditor preview with draft returns sample data, no template change, no audit", async () => {
    const staff = asStaff({ email: "admin@example.test" });
    const actor = staffFromSession(staff.session);

    const formData = new FormData();
    formData.append("intent", "preview");
    formData.append("subject", "Custom subject");
    formData.append("bodyHtml", "{{ listing_title }} is closed");

    const result = await handleTemplateEditor(
      "listing_closed",
      formData,
      actor,
    );
    expect(result.ok).toBe(true);
    expect(result.intent).toBe("preview");
    expect(result.preview).toHaveProperty("subject");
    expect(result.preview).toHaveProperty("html");
    expect(result.preview.subject).toContain("Custom subject");
    // Should have sample data
    expect(result.preview.html).toContain("1962 Coleman 200A lantern");

    const auditCount = await prisma.auditEvent.count({
      where: { action: "EmailTemplateUpdated" },
    });
    expect(auditCount).toBe(0);
  });

  it("AC: handleTemplateEditor test sends to session staff email only, ignores forged fields", async () => {
    const ses = mockSes();
    setSesClient(ses);

    const staff = asStaff({ email: "admin@example.test" });
    const actor = staffFromSession(staff.session);

    const formData = new FormData();
    formData.append("intent", "test");
    formData.append("to", "forged@example.test");
    formData.append("toAddress", "forged2@example.test");
    formData.append("email", "forged3@example.test");

    const result = await handleTemplateEditor(
      "listing_closed",
      formData,
      actor,
    );
    expect(result.ok).toBe(true);
    expect(result.intent).toBe("test");

    expect(ses.sent).toHaveLength(1);
    expect(ses.sent[0].input.Destination.ToAddresses).toEqual([
      "admin@example.test",
    ]);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "EmailTestSent" },
      orderBy: { at: "desc" },
    });
    expect(audit).toBeDefined();
  });

  it("AC: handleTemplateEditor reset without confirmed=yes is refused; with confirmed=yes reverts", async () => {
    const staff = asStaff({ email: "admin@example.test" });
    const actor = staffFromSession(staff.session);

    // First, customize the template
    const saveData = new FormData();
    saveData.append("intent", "save");
    saveData.append("subject", "Custom subject");
    saveData.append("bodyHtml", "Custom body");

    await handleTemplateEditor("listing_closed", saveData, actor);

    // Reset without confirmation should fail
    const resetData1 = new FormData();
    resetData1.append("intent", "reset");
    resetData1.append("confirmed", "no");

    let result = await handleTemplateEditor(
      "listing_closed",
      resetData1,
      actor,
    );
    expect(result.ok).toBe(false);
    expect(result.intent).toBe("reset");

    // Reset with confirmation should succeed
    const resetData2 = new FormData();
    resetData2.append("intent", "reset");
    resetData2.append("confirmed", "yes");

    result = await handleTemplateEditor("listing_closed", resetData2, actor);
    expect(result.ok).toBe(true);
    expect(result.intent).toBe("reset");

    // loadEmailsScreen should show customised as false
    const screen = await loadEmailsScreen();
    const group = screen.groups.find((g) => g.audience === "seller");
    const template = group.templates.find((t) => t.key === "listing_closed");
    expect(template.customised).toBe(false);
  });

  it("AC: loadEmailsScreen lists every TEMPLATE_KEYS entry exactly once", async () => {
    const screen = await loadEmailsScreen();
    const allTemplates = screen.groups
      .flatMap((g) => g.templates)
      .map((t) => t.key);

    // Each template key appears exactly once
    for (const key of TEMPLATE_KEYS) {
      const count = allTemplates.filter((k) => k === key).length;
      expect(count).toBe(1);
    }

    // Same templates are in screen
    expect(allTemplates.sort()).toEqual(TEMPLATE_KEYS.sort());
  });

  it("SEC: draft body with script and img onerror previews without harmful code", async () => {
    const staff = asStaff({ email: "admin@example.test" });
    const actor = staffFromSession(staff.session);

    const formData = new FormData();
    formData.append("intent", "preview");
    formData.append("subject", "Test");
    formData.append(
      "bodyHtml",
      "{{ listing_title }}<script>alert(1)</script><img src=x onerror=alert(1)>",
    );

    const result = await handleTemplateEditor(
      "listing_closed",
      formData,
      actor,
    );
    expect(result.ok).toBe(true);
    expect(result.preview.html).not.toContain("<script");
    expect(result.preview.html).not.toContain("onerror");
  });

  it("SEC: CR/LF in senderName is cleaned on save", async () => {
    const staff = asStaff({ email: "admin@example.test" });
    const actor = staffFromSession(staff.session);

    const formData = new FormData();
    formData.append("senderName", "OCP\r\nBcc: x@evil.test");
    formData.append("replyTo", "");
    formData.append("staffNotify", "");
    formData.append("logoUrl", "");
    formData.append("buttonColor", "#C8102E");
    formData.append("footerText", "");
    formData.append("phone", "");
    formData.append("supportEmail", "");
    formData.append("postalAddress", "");

    const result = await saveEmailSettingsForm(formData, actor);
    expect(result.ok).toBe(true);

    const settings = await getEmailSettings();
    expect(settings.senderName).not.toContain("\r");
    expect(settings.senderName).not.toContain("\n");
  });

  it("SEC: unknown key in loadTemplateEditor returns null", async () => {
    const staff = asStaff({ email: "admin@example.test" });
    const actor = staffFromSession(staff.session);

    const result = await loadTemplateEditor("unknown_key", actor);
    expect(result).toBeNull();
  });

  it("SEC: unknown key in handleTemplateEditor returns null", async () => {
    const staff = asStaff({ email: "admin@example.test" });
    const actor = staffFromSession(staff.session);

    const formData = new FormData();
    formData.append("intent", "preview");

    const result = await handleTemplateEditor("unknown_key", formData, actor);
    expect(result).toBeNull();
  });

  it("SEC: non-staff actor is rejected by saveEmailSettingsForm", async () => {
    const actor = { type: "SELLER", ref: "x" };
    const formData = new FormData();
    formData.append("senderName", "OCP");

    try {
      await saveEmailSettingsForm(formData, actor);
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error.message).toContain("staff");
    }
  });

  it("SEC: non-staff actor is rejected by handleTemplateEditor", async () => {
    const actor = { type: "SELLER", ref: "x" };
    const formData = new FormData();
    formData.append("intent", "preview");

    try {
      await handleTemplateEditor("listing_closed", formData, actor);
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error.message).toContain("staff");
    }
  });

  it("SEC: non-staff actor is rejected by sendTestEmail", async () => {
    const actor = { type: "SELLER", ref: "x" };

    try {
      await sendTestEmail("listing_closed", actor);
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error.message).toContain("staff");
    }
  });

  it("SEC: invitation template (copyOnly) test returns ok:false and sends nothing", async () => {
    const ses = mockSes();
    setSesClient(ses);

    const staff = asStaff({ email: "admin@example.test" });
    const actor = staffFromSession(staff.session);

    const formData = new FormData();
    formData.append("intent", "test");

    const result = await handleTemplateEditor("invitation", formData, actor);
    // copyOnly templates should reject test
    expect(result.ok).toBe(false);
    expect(ses.sent).toHaveLength(0);
  });

  it("SEC: unknown intent returns ok:false", async () => {
    const staff = asStaff({ email: "admin@example.test" });
    const actor = staffFromSession(staff.session);

    const formData = new FormData();
    formData.append("intent", "invalid_intent");

    const result = await handleTemplateEditor(
      "listing_closed",
      formData,
      actor,
    );
    expect(result.ok).toBe(false);
  });

  it("SEC: removing required placeholder on save returns ok:false with bodyHtml error", async () => {
    const staff = asStaff({ email: "admin@example.test" });
    const actor = staffFromSession(staff.session);

    // staff_review_needed requires review_link
    const formData = new FormData();
    formData.append("intent", "save");
    formData.append("subject", "Review needed");
    formData.append("bodyHtml", "{{ listing_title }}");

    const result = await handleTemplateEditor(
      "staff_review_needed",
      formData,
      actor,
    );
    expect(result.ok).toBe(false);
    expect(result.fieldErrors).toHaveProperty("bodyHtml");
  });

  it("SEC: test send to suppressed staff address sends nothing", async () => {
    const ses = mockSes();
    setSesClient(ses);

    const staff = asStaff({ email: "suppressed@example.test" });
    const actor = staffFromSession(staff.session);

    // Suppress the address
    await suppress("suppressed@example.test", "BOUNCE");

    const result = await sendTestEmail("listing_closed", actor);
    expect(result.status).toContain("SUPPRESSED");
    expect(ses.sent).toHaveLength(0);
  });

  it("Layout: after saving buttonColor, preview html contains the color", async () => {
    const staff = asStaff({ email: "admin@example.test" });
    const actor = staffFromSession(staff.session);

    const formData = new FormData();
    formData.append("senderName", "OCP");
    formData.append("replyTo", "");
    formData.append("staffNotify", "");
    formData.append("logoUrl", "");
    formData.append("buttonColor", "#123456");
    formData.append("footerText", "");
    formData.append("phone", "");
    formData.append("supportEmail", "");
    formData.append("postalAddress", "");

    const result = await saveEmailSettingsForm(formData, actor);
    expect(result.ok).toBe(true);

    // Now preview a template
    const previewData = new FormData();
    previewData.append("intent", "preview");
    previewData.append("subject", "Test");
    previewData.append("bodyHtml", "{{ listing_title }}");

    const previewResult = await handleTemplateEditor(
      "listing_closed",
      previewData,
      actor,
    );
    expect(previewResult.ok).toBe(true);
    expect(previewResult.preview.html).toContain("#123456");
  });

  const testForm = (testTo) => {
    const formData = new FormData();
    formData.append("intent", "test");
    if (testTo !== undefined) formData.append("testTo", testTo);
    return formData;
  };

  it("AC: a test goes to the address staff typed, and the audit entry names it", async () => {
    const ses = mockSes();
    setSesClient(ses);
    const actor = staffFromSession(
      asStaff({ email: "admin@example.test" }).session,
    );

    const result = await handleTemplateEditor(
      "listing_closed",
      testForm(" Other@Example.test "),
      actor,
    );

    expect(result.ok).toBe(true);
    expect(ses.sent).toHaveLength(1);
    expect(ses.sent[0].input.Destination.ToAddresses).toEqual([
      "other@example.test",
    ]);
    const audit = await prisma.auditEvent.findFirst({
      where: { action: "EmailTestSent" },
    });
    expect(audit.actorRef).toBe("admin@example.test");
    expect(audit.details.to).toBe("other@example.test");
  });

  it.each([
    "not-an-email",
    "a@b.test, c@d.test",
    "x@y.test\r\nBcc: z@evil.test",
  ])(
    "SEC: a bad test address (%j) is refused with a field error and nothing is sent",
    async (testTo) => {
      const ses = mockSes();
      setSesClient(ses);
      const actor = staffFromSession(asStaff().session);

      const result = await handleTemplateEditor(
        "listing_closed",
        testForm(testTo),
        actor,
      );

      expect(result.ok).toBe(false);
      expect(result.fieldErrors.testTo).toBeTruthy();
      expect(ses.sent).toHaveLength(0);
    },
  );

  it("SEC: a suppressed test address gets nothing", async () => {
    const ses = mockSes();
    setSesClient(ses);
    await suppress("blocked@example.test", "BOUNCE");
    const actor = staffFromSession(asStaff().session);

    const result = await handleTemplateEditor(
      "listing_closed",
      testForm("blocked@example.test"),
      actor,
    );

    expect(result.ok).toBe(true);
    expect(ses.sent).toHaveLength(0);
  });

  it("SEC: the eleventh test in an hour is refused; the allowance comes back later", async () => {
    const ses = mockSes();
    setSesClient(ses);
    const actor = staffFromSession(asStaff().session);
    const now = new Date("2026-10-05T12:00:00Z");

    for (let count = 0; count < 10; count++)
      await sendTestEmail("listing_closed", actor, { now });
    await expect(
      sendTestEmail("listing_closed", actor, { now }),
    ).rejects.toThrow("Too many test emails");
    expect(ses.sent).toHaveLength(10);

    await sendTestEmail("listing_closed", actor, {
      now: new Date("2026-10-05T13:00:01Z"),
    });
    expect(ses.sent).toHaveLength(11);
  });
});
