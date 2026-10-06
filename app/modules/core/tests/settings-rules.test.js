import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { asStaff } from "@/../tests/factories.js";
import {
  getSettings,
  updateSettings,
  setFlag,
  ValidationError,
  ForbiddenActorError,
} from "@/modules/core/index.js";

describe("Settings rules text (AC + SEC: version bump, validation, audit)", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  const staff = asStaff();
  const staffActor = { type: "STAFF", ref: staff.session.email };

  describe("AC: Changed rules text bumps version and is audited", () => {
    it("AC: first text change bumps version from draft-0 to v1 with audit", async () => {
      const initial = await getSettings();
      expect(initial.rulesVersion).toBe("draft-0");

      const newText = "No sales of Coleman parts after 2030.";
      const { settings: saved, changed } = await updateSettings(
        { rulesText: newText },
        staffActor,
      );

      expect(saved.rulesVersion).toBe("v1");
      expect(saved.rulesText).toBe(newText);
      expect(changed).toContain("rulesText");
      expect(changed).toContain("rulesVersion");

      const audit = await prisma.auditEvent.findFirst({
        where: { action: "SettingsUpdated" },
      });
      expect(audit).toBeDefined();
      expect(audit.actorRef).toBe(staff.session.email);
      expect(audit.details.changes).toHaveProperty("rulesText");
      expect(audit.details.changes).toHaveProperty("rulesVersion");
      expect(audit.details.changes.rulesVersion.from).toBe("draft-0");
      expect(audit.details.changes.rulesVersion.to).toBe("v1");
    });

    it("AC: second text change bumps version from v1 to v2", async () => {
      const text1 = "Version 1 rules";
      await updateSettings({ rulesText: text1 }, staffActor);

      const text2 = "Version 2 rules";
      const { settings: saved } = await updateSettings(
        { rulesText: text2 },
        staffActor,
      );

      expect(saved.rulesVersion).toBe("v2");
      expect(saved.rulesText).toBe(text2);

      const audits = await prisma.auditEvent.findMany({
        where: { action: "SettingsUpdated" },
      });
      expect(audits).toHaveLength(2);
      expect(audits[1].details.changes.rulesVersion.from).toBe("v1");
      expect(audits[1].details.changes.rulesVersion.to).toBe("v2");
    });
  });

  describe("AC: Unchanged rules text does not bump version or create audit", () => {
    it("AC: exact same text is treated as no change", async () => {
      const text = "Original rules text";
      await updateSettings({ rulesText: text }, staffActor);

      const { changed } = await updateSettings({ rulesText: text }, staffActor);
      expect(changed).toHaveLength(0);

      const audits = await prisma.auditEvent.findMany({
        where: { action: "SettingsUpdated" },
      });
      expect(audits).toHaveLength(1); // Only the first save
    });

    it("AC: CRLF normalized to LF is treated as same text", async () => {
      const textLF = "Line 1\nLine 2\nLine 3";
      await updateSettings({ rulesText: textLF }, staffActor);

      // Same text but with CRLF
      const textCRLF = "Line 1\r\nLine 2\r\nLine 3";
      const { changed } = await updateSettings(
        { rulesText: textCRLF },
        staffActor,
      );
      expect(changed).toHaveLength(0);

      const audits = await prisma.auditEvent.findMany({
        where: { action: "SettingsUpdated" },
      });
      expect(audits).toHaveLength(1);
    });

    it("AC: trailing whitespace is normalized away and treated as same text", async () => {
      const text = "Rules text";
      await updateSettings({ rulesText: text }, staffActor);

      const { changed } = await updateSettings(
        { rulesText: "Rules text  " },
        staffActor,
      );
      expect(changed).toHaveLength(0);

      const audits = await prisma.auditEvent.findMany({
        where: { action: "SettingsUpdated" },
      });
      expect(audits).toHaveLength(1);
    });
  });

  describe("SEC: Rules text validation rejects bad input", () => {
    it.each([
      ["empty text", ""],
      ["text with <script> tag", "Rules include <script>alert(1)</script>"],
      ["text with angle brackets", "Do not use <tags> here"],
      ["text with > character", "This > that"],
      ["text with < character", "This < that"],
    ])("SEC: rejects %s", async (desc, text) => {
      await expect(
        updateSettings({ rulesText: text }, staffActor),
      ).rejects.toThrow(ValidationError);

      const settings = await getSettings();
      expect(settings.rulesText).toBe(
        "Listing rules have not been published yet.",
      ); // Unchanged

      const audits = await prisma.auditEvent.findMany({
        where: { action: "SettingsUpdated" },
      });
      expect(audits).toHaveLength(0);
    });

    it("SEC: rejects text over 20000 characters", async () => {
      const tooLong = "a".repeat(20001);
      await expect(
        updateSettings({ rulesText: tooLong }, staffActor),
      ).rejects.toThrow(ValidationError);

      const audits = await prisma.auditEvent.findMany({
        where: { action: "SettingsUpdated" },
      });
      expect(audits).toHaveLength(0);
    });

    it("SEC: accepts text at max 20000 characters", async () => {
      const maxText = "a".repeat(20000);
      const { changed } = await updateSettings(
        { rulesText: maxText },
        staffActor,
      );
      expect(changed).toContain("rulesText");

      const audits = await prisma.auditEvent.findMany({
        where: { action: "SettingsUpdated" },
      });
      expect(audits).toHaveLength(1);
    });

    it("SEC: rejects patch with rulesVersion key", async () => {
      await expect(
        updateSettings(
          { rulesText: "New text", rulesVersion: "v5" },
          staffActor,
        ),
      ).rejects.toThrow(ValidationError);

      const audits = await prisma.auditEvent.findMany({
        where: { action: "SettingsUpdated" },
      });
      expect(audits).toHaveLength(0);
    });
  });

  describe("SEC: Non-staff actors cannot update rules", () => {
    it.each([
      ["SELLER", { type: "SELLER" }],
      ["SYSTEM", { type: "SYSTEM" }],
    ])("SEC: %s actor is refused", async (desc, actor) => {
      await expect(
        updateSettings({ rulesText: "New rules" }, actor),
      ).rejects.toThrow(ForbiddenActorError);

      const audits = await prisma.auditEvent.findMany({
        where: { action: "SettingsUpdated" },
      });
      expect(audits).toHaveLength(0);
    });
  });

  describe("AC: setFlag returns false when flag already has that value", () => {
    it("AC: setting alerts to true when already true returns false and adds no audit", async () => {
      // Alerts is enabled by default, so set it explicitly first
      const initial = await getSettings();
      expect(initial.alertsEnabled).toBe(true);

      const result = await setFlag("alerts", true, staffActor);
      expect(result).toBe(false);

      const audits = await prisma.auditEvent.findMany({
        where: { action: "FeatureToggled" },
      });
      expect(audits).toHaveLength(0);
    });

    it("AC: setting alerts to false, then false again returns false on second call", async () => {
      // Turn off alerts
      await setFlag("alerts", false, staffActor);

      // Try to turn off again
      const result = await setFlag("alerts", false, staffActor);
      expect(result).toBe(false);

      const audits = await prisma.auditEvent.findMany({
        where: { action: "FeatureToggled" },
      });
      expect(audits).toHaveLength(1); // Only from the first toggle
    });
  });
});
