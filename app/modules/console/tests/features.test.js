import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { asStaff } from "@/../tests/factories.js";
import {
  loadFeaturesCard,
  saveFeatureToggle,
} from "@/modules/console/index.js";

describe("Console features card (AC + SEC: toggle, gates, validation)", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
    process.env.RENEWALS_RELEASED = "false";
    process.env.OPEN_SUBMISSIONS_RELEASED = "false";
  });

  afterEach(() => {
    delete process.env.RENEWALS_RELEASED;
    delete process.env.OPEN_SUBMISSIONS_RELEASED;
  });

  const staff = asStaff();
  const staffActor = { type: "STAFF", ref: staff.session.email };

  describe("AC: Toggling alerts writes audit with staff email and changes setting", () => {
    it("AC: toggling alerts from true to false writes FeatureToggled audit", async () => {
      const form = new FormData();
      form.set("flag", "alerts");
      form.set("value", "false");
      form.set("confirmed", "yes");

      const result = await saveFeatureToggle(form, staffActor);
      expect(result.ok).toBe(true);
      expect(result.flag).toBe("alerts");
      expect(result.value).toBe(false);

      const audit = await prisma.auditEvent.findFirst({
        where: { action: "FeatureToggled" },
      });
      expect(audit).toBeDefined();
      expect(audit.actorRef).toBe(staff.session.email);
      expect(audit.details.staff).toBe(staff.session.email);
      expect(audit.details.flag).toBe("alerts");
      expect(audit.details.value).toBe(false);
    });

    it("AC: toggling alerts from false to true writes audit and changes setting", async () => {
      // First turn it off
      const form1 = new FormData();
      form1.set("flag", "alerts");
      form1.set("value", "false");
      form1.set("confirmed", "yes");
      await saveFeatureToggle(form1, staffActor);

      // Then turn it on
      const form2 = new FormData();
      form2.set("flag", "alerts");
      form2.set("value", "true");

      const result = await saveFeatureToggle(form2, staffActor);
      expect(result.ok).toBe(true);
      expect(result.value).toBe(true);

      const audits = await prisma.auditEvent.findMany({
        where: { action: "FeatureToggled" },
      });
      expect(audits).toHaveLength(2);
      expect(audits[1].details.value).toBe(true);
    });
  });

  describe("AC: Feature card lists released features only", () => {
    it("AC: card shows alerts when gate is open (default)", async () => {
      process.env.RENEWALS_RELEASED = "false";
      process.env.OPEN_SUBMISSIONS_RELEASED = "false";

      const card = await loadFeaturesCard();
      const flags = card.features.map((f) => f.flag);

      expect(flags).toContain("alerts");
      expect(flags).not.toContain("renewals");
      expect(flags).not.toContain("openSubmissions");
    });

    it("AC: card omits renewals when gate is closed", async () => {
      process.env.RENEWALS_RELEASED = "false";

      const card = await loadFeaturesCard();
      const flags = card.features.map((f) => f.flag);

      expect(flags).not.toContain("renewals");
    });

    it("AC: card shows renewals when gate is open", async () => {
      process.env.RENEWALS_RELEASED = "true";

      const card = await loadFeaturesCard();
      const flags = card.features.map((f) => f.flag);

      expect(flags).toContain("renewals");
    });

    it("AC: card omits openSubmissions when gate is closed", async () => {
      process.env.OPEN_SUBMISSIONS_RELEASED = "false";

      const card = await loadFeaturesCard();
      const flags = card.features.map((f) => f.flag);

      expect(flags).not.toContain("openSubmissions");
    });
  });

  describe("SEC: Unreleased features cannot be toggled", () => {
    it("SEC: turning on unreleased feature (renewals) is rejected", async () => {
      process.env.RENEWALS_RELEASED = "false";

      const form = new FormData();
      form.set("flag", "renewals");
      form.set("value", "true");

      const result = await saveFeatureToggle(form, staffActor);
      expect(result.ok).toBe(false);

      const audits = await prisma.auditEvent.findMany({
        where: { action: "FeatureToggled" },
      });
      expect(audits).toHaveLength(0);
    });

    it("SEC: turning off unreleased feature is also rejected", async () => {
      process.env.RENEWALS_RELEASED = "false";

      const form = new FormData();
      form.set("flag", "renewals");
      form.set("value", "false");
      form.set("confirmed", "yes");

      const result = await saveFeatureToggle(form, staffActor);
      expect(result.ok).toBe(false);

      const audits = await prisma.auditEvent.findMany({
        where: { action: "FeatureToggled" },
      });
      expect(audits).toHaveLength(0);
    });
  });

  describe("SEC: Invalid flag names and values are rejected", () => {
    it.each([["__proto__"], ["alertsEnabled"], ["unknown"]])(
      "SEC: unknown flag %s is rejected",
      async (flag) => {
        const form = new FormData();
        form.set("flag", flag);
        form.set("value", "true");

        const result = await saveFeatureToggle(form, staffActor);
        expect(result.ok).toBe(false);
        expect(result.error).toBeDefined();
      },
    );

    it("SEC: invalid value like '1' is rejected", async () => {
      const form = new FormData();
      form.set("flag", "alerts");
      form.set("value", "1");

      const result = await saveFeatureToggle(form, staffActor);
      expect(result.ok).toBe(false);
    });
  });

  describe("SEC: Turning feature off requires confirmation", () => {
    it("SEC: turning off without confirmed=yes is rejected", async () => {
      const form = new FormData();
      form.set("flag", "alerts");
      form.set("value", "false");
      // no confirmed field

      const result = await saveFeatureToggle(form, staffActor);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Confirm");

      const audits = await prisma.auditEvent.findMany({
        where: { action: "FeatureToggled" },
      });
      expect(audits).toHaveLength(0);
    });

    it("SEC: turning off with confirmed=yes succeeds", async () => {
      const form = new FormData();
      form.set("flag", "alerts");
      form.set("value", "false");
      form.set("confirmed", "yes");

      const result = await saveFeatureToggle(form, staffActor);
      expect(result.ok).toBe(true);

      const audits = await prisma.auditEvent.findMany({
        where: { action: "FeatureToggled" },
      });
      expect(audits).toHaveLength(1);
    });

    it("SEC: turning on does not require confirmation", async () => {
      // First turn alerts off
      const form1 = new FormData();
      form1.set("flag", "alerts");
      form1.set("value", "false");
      form1.set("confirmed", "yes");
      await saveFeatureToggle(form1, staffActor);

      // Then turn on without confirmation
      const form = new FormData();
      form.set("flag", "alerts");
      form.set("value", "true");
      // no confirmed field

      const result = await saveFeatureToggle(form, staffActor);
      expect(result.ok).toBe(true);
    });
  });

  describe("SEC: Non-staff actors are rejected", () => {
    it("SEC: SELLER actor throws when trying to toggle", async () => {
      const sellerActor = { type: "SELLER" };

      const form = new FormData();
      form.set("flag", "alerts");
      form.set("value", "false");
      form.set("confirmed", "yes");

      await expect(saveFeatureToggle(form, sellerActor)).rejects.toThrow();

      const audits = await prisma.auditEvent.findMany({
        where: { action: "FeatureToggled" },
      });
      expect(audits).toHaveLength(0);
    });
  });
});
