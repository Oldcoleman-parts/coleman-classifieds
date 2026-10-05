import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { asStaff } from "@/../tests/factories.js";
import {
  getSettings,
  updateSettings,
  staffFromSession,
  ValidationError,
  ForbiddenActorError,
  UnauthorizedError,
} from "@/modules/core/index.js";

describe("Settings (AC + SEC: bounds, whitelist, audit)", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  const staff = asStaff();
  const staffActor = { type: "STAFF", ref: staff.session.email };

  describe("AC: Out-of-range values are rejected and nothing is saved", () => {
    it.each([
      ["baseFeeCents", -1, "must be in the range 0–100000000"],
      ["baseFeeCents", 100000001, "must be in the range 0–100000000"],
      ["promoFeeCents", -1, "must be in the range 0–100000000"],
      ["promoFeeCents", 100000001, "must be in the range 0–100000000"],
      ["paymentWindowDays", 0, "must be in the range 1–60"],
      ["paymentWindowDays", 61, "must be in the range 1–60"],
      ["draftWindowDays", 0, "must be in the range 1–60"],
      ["draftWindowDays", 61, "must be in the range 1–60"],
      ["correctionWindowDays", 0, "must be in the range 1–60"],
      ["correctionWindowDays", 61, "must be in the range 1–60"],
      ["inviteExpiryDays", 0, "must be in the range 1–60"],
      ["inviteExpiryDays", 61, "must be in the range 1–60"],
      ["maxPhotos", 0, "must be in the range 1–12"],
      ["maxPhotos", 13, "must be in the range 1–12"],
    ])("rejects $field $value", async (field, value) => {
      const patch = { [field]: value };
      await expect(updateSettings(patch, staffActor)).rejects.toThrow(
        ValidationError,
      );

      const settings = await getSettings();
      const original = await prisma.settings.findUnique({ where: { id: 1 } });
      expect(settings[field]).toEqual(original[field]);

      const audits = await prisma.auditEvent.findMany({
        where: { action: "SettingsUpdated" },
      });
      expect(audits).toHaveLength(0);
    });

    it("AC: promo fee above base fee is rejected", async () => {
      await expect(
        updateSettings({ baseFeeCents: 3000, promoFeeCents: 5000 }, staffActor),
      ).rejects.toThrow(ValidationError);

      const audits = await prisma.auditEvent.findMany({
        where: { action: "SettingsUpdated" },
      });
      expect(audits).toHaveLength(0);
    });

    it("AC: malformed heldMessageRules are rejected", async () => {
      // Missing keys
      await expect(
        updateSettings(
          { heldMessageRules: { holdOnLinks: true, keywords: [] } },
          staffActor,
        ),
      ).rejects.toThrow(ValidationError);

      // Extra keys
      await expect(
        updateSettings(
          {
            heldMessageRules: {
              holdOnLinks: true,
              keywords: [],
              repeatThreshold: 3,
              extra: true,
            },
          },
          staffActor,
        ),
      ).rejects.toThrow(ValidationError);

      // Invalid keyword length
      await expect(
        updateSettings(
          {
            heldMessageRules: {
              holdOnLinks: true,
              keywords: ["x".repeat(61)],
              repeatThreshold: 3,
            },
          },
          staffActor,
        ),
      ).rejects.toThrow(ValidationError);

      // Invalid repeatThreshold
      await expect(
        updateSettings(
          {
            heldMessageRules: {
              holdOnLinks: true,
              keywords: [],
              repeatThreshold: 21,
            },
          },
          staffActor,
        ),
      ).rejects.toThrow(ValidationError);

      const audits = await prisma.auditEvent.findMany({
        where: { action: "SettingsUpdated" },
      });
      expect(audits).toHaveLength(0);
    });
  });

  describe("AC: Unknown/non-whitelisted keys are rejected and nothing is saved", () => {
    it("rejects unknown keys", async () => {
      await expect(
        updateSettings(
          { rulesText: "new rules", baseFeeCents: 3000 },
          staffActor,
        ),
      ).rejects.toThrow(ValidationError);

      await expect(
        updateSettings({ feeProductGid: "gid://123" }, staffActor),
      ).rejects.toThrow(ValidationError);

      await expect(
        updateSettings({ alertsEnabled: true }, staffActor),
      ).rejects.toThrow(ValidationError);

      const audits = await prisma.auditEvent.findMany({
        where: { action: "SettingsUpdated" },
      });
      expect(audits).toHaveLength(0);
    });
  });

  describe("AC: Multi-field failures report all problems and save nothing", () => {
    it("collects errors from multiple fields", async () => {
      try {
        await updateSettings(
          {
            baseFeeCents: -1,
            promoFeeCents: 200000000,
            paymentWindowDays: 0,
            maxPhotos: 20,
          },
          staffActor,
        );
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.fields).toHaveProperty("baseFeeCents");
        expect(error.fields).toHaveProperty("promoFeeCents");
        expect(error.fields).toHaveProperty("paymentWindowDays");
        expect(error.fields).toHaveProperty("maxPhotos");
      }

      const audits = await prisma.auditEvent.findMany({
        where: { action: "SettingsUpdated" },
      });
      expect(audits).toHaveLength(0);
    });
  });

  describe("AC: A valid save persists and can be re-read", () => {
    it("valid patch saves and re-reads", async () => {
      const { settings: saved } = await updateSettings(
        { baseFeeCents: 5000, paymentWindowDays: 10 },
        staffActor,
      );
      expect(saved.baseFeeCents).toBe(5000);
      expect(saved.paymentWindowDays).toBe(10);

      const reread = await getSettings();
      expect(reread.baseFeeCents).toBe(5000);
      expect(reread.paymentWindowDays).toBe(10);
    });

    it("keywords are deduplicated and stored", async () => {
      const { settings } = await updateSettings(
        {
          heldMessageRules: {
            holdOnLinks: true,
            keywords: ["spam", "  SPAM  ", "scam"],
            repeatThreshold: 3,
          },
        },
        staffActor,
      );
      expect(settings.heldMessageRules.keywords).toEqual(["spam", "scam"]);
    });
  });

  describe("AC: Every valid save writes one SettingsUpdated AuditEvent with staff email and changes", () => {
    it("saves with changed fields writes exactly one audit row", async () => {
      const { changed } = await updateSettings(
        { baseFeeCents: 7000 },
        staffActor,
      );
      expect(changed).toEqual(["baseFeeCents"]);

      const audits = await prisma.auditEvent.findMany({
        where: { action: "SettingsUpdated" },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].actor).toBe("STAFF");
      expect(audits[0].actorRef).toBe(staff.session.email);
      expect(audits[0].details.changes).toEqual({
        baseFeeCents: { from: 3000, to: 7000 },
      });
    });

    it("saves with no changes writes no audit row", async () => {
      await updateSettings({ baseFeeCents: 3000 }, staffActor);

      const audits = await prisma.auditEvent.findMany({
        where: { action: "SettingsUpdated" },
      });
      expect(audits).toHaveLength(0);
    });

    it("audit includes from/to for each changed field", async () => {
      await updateSettings(
        {
          baseFeeCents: 5000,
          promoFeeCents: 2000,
          maxPhotos: 8,
        },
        staffActor,
      );

      const audit = await prisma.auditEvent.findFirst({
        where: { action: "SettingsUpdated" },
      });
      expect(audit.details.changes).toEqual({
        baseFeeCents: { from: 3000, to: 5000 },
        promoFeeCents: { from: null, to: 2000 },
        maxPhotos: { from: 12, to: 8 },
      });
    });
  });

  describe("SEC: SELLER, SYSTEM actors and STAFF without email are refused", () => {
    it("SELLER actor is refused", async () => {
      await expect(
        updateSettings({ baseFeeCents: 5000 }, { type: "SELLER" }),
      ).rejects.toThrow(ForbiddenActorError);

      const audits = await prisma.auditEvent.findMany({
        where: { action: "SettingsUpdated" },
      });
      expect(audits).toHaveLength(0);
    });

    it("SYSTEM actor is refused", async () => {
      await expect(
        updateSettings({ baseFeeCents: 5000 }, { type: "SYSTEM" }),
      ).rejects.toThrow(ForbiddenActorError);

      const audits = await prisma.auditEvent.findMany({
        where: { action: "SettingsUpdated" },
      });
      expect(audits).toHaveLength(0);
    });

    it("STAFF actor without email is refused", async () => {
      await expect(
        updateSettings({ baseFeeCents: 5000 }, { type: "STAFF" }),
      ).rejects.toThrow(ForbiddenActorError);

      const audits = await prisma.auditEvent.findMany({
        where: { action: "SettingsUpdated" },
      });
      expect(audits).toHaveLength(0);
    });
  });

  describe("staffFromSession: returns staff actor from online session", () => {
    it("extracts email from online session", () => {
      const actor = staffFromSession(staff.session);
      expect(actor).toEqual({ type: "STAFF", ref: staff.session.email });
    });

    it("trims and lowercases email", () => {
      const actor = staffFromSession({
        onlineAccessInfo: {
          associated_user: { email: "  Staff@Example.Test  " },
        },
      });
      expect(actor).toEqual({ type: "STAFF", ref: "staff@example.test" });
    });

    it("throws UnauthorizedError when no email", () => {
      expect(() => staffFromSession(null)).toThrow(UnauthorizedError);
      expect(() => staffFromSession({ onlineAccessInfo: null })).toThrow(
        UnauthorizedError,
      );
      expect(() =>
        staffFromSession({ onlineAccessInfo: { associated_user: null } }),
      ).toThrow(UnauthorizedError);
      expect(() =>
        staffFromSession({ onlineAccessInfo: { associated_user: {} } }),
      ).toThrow(UnauthorizedError);
      expect(() =>
        staffFromSession({
          onlineAccessInfo: { associated_user: { email: "" } },
        }),
      ).toThrow(UnauthorizedError);
    });
  });
});
