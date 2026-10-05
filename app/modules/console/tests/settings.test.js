import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { resetDb } from "@/../tests/db.js";
import { asStaff } from "@/../tests/factories.js";
import { loadSettingsForm, saveSettingsForm } from "@/modules/console/index.js";

describe("Console settings form (AC + SEC: dollars, keywords, field mapping)", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  const staff = asStaff();
  const staffActor = { type: "STAFF", ref: staff.session.email };

  describe("AC: Dollars ↔ cents round trip", () => {
    it("saves cents and loads as dollars", async () => {
      const form = new FormData();
      form.set("baseFee", "30.00");
      form.set("promoFee", "15.50");
      form.set("paymentWindowDays", "7");
      form.set("draftWindowDays", "14");
      form.set("correctionWindowDays", "14");
      form.set("inviteExpiryDays", "30");
      form.set("maxPhotos", "8");
      form.set("holdOnLinks", "on");
      form.set("keywords", "");
      form.set("repeatThreshold", "3");

      const { ok } = await saveSettingsForm(form, staffActor);
      expect(ok).toBe(true);

      const loaded = await loadSettingsForm();
      expect(loaded.baseFee).toBe("30.00");
      expect(loaded.promoFee).toBe("15.50");
    });

    it("accepts dollars without cents", async () => {
      const form = new FormData();
      form.set("baseFee", "25");
      form.set("promoFee", "");
      form.set("paymentWindowDays", "7");
      form.set("draftWindowDays", "14");
      form.set("correctionWindowDays", "14");
      form.set("inviteExpiryDays", "30");
      form.set("maxPhotos", "8");
      form.set("holdOnLinks", "on");
      form.set("keywords", "");
      form.set("repeatThreshold", "3");

      const { ok } = await saveSettingsForm(form, staffActor);
      expect(ok).toBe(true);

      const loaded = await loadSettingsForm();
      expect(loaded.baseFee).toBe("25.00");
    });

    it("rejects bad dollar amounts", async () => {
      const form = new FormData();
      form.set("baseFee", "30.555");
      form.set("promoFee", "");
      form.set("paymentWindowDays", "7");
      form.set("draftWindowDays", "14");
      form.set("correctionWindowDays", "14");
      form.set("inviteExpiryDays", "30");
      form.set("maxPhotos", "8");
      form.set("keywords", "");
      form.set("repeatThreshold", "3");

      const { ok, fieldErrors } = await saveSettingsForm(form, staffActor);
      expect(ok).toBe(false);
      expect(fieldErrors.baseFee).toContain("must be an amount");
    });

    it("rejects non-numeric amounts", async () => {
      const form = new FormData();
      form.set("baseFee", "abc");
      form.set("promoFee", "");
      form.set("paymentWindowDays", "7");
      form.set("draftWindowDays", "14");
      form.set("correctionWindowDays", "14");
      form.set("inviteExpiryDays", "30");
      form.set("maxPhotos", "8");
      form.set("keywords", "");
      form.set("repeatThreshold", "3");

      const { ok, fieldErrors } = await saveSettingsForm(form, staffActor);
      expect(ok).toBe(false);
      expect(fieldErrors.baseFee).toBeDefined();
    });
  });

  describe("AC: Empty promo fee saves null; absent switch saves false", () => {
    it("empty promoFee string saves null", async () => {
      const form = new FormData();
      form.set("baseFee", "30");
      form.set("promoFee", "");
      form.set("paymentWindowDays", "7");
      form.set("draftWindowDays", "14");
      form.set("correctionWindowDays", "14");
      form.set("inviteExpiryDays", "30");
      form.set("maxPhotos", "8");
      form.set("keywords", "");
      form.set("repeatThreshold", "3");

      await saveSettingsForm(form, staffActor);
      const loaded = await loadSettingsForm();
      expect(loaded.promoFee).toBe("");
    });

    it("missing checkbox saves false", async () => {
      const form = new FormData();
      form.set("baseFee", "30");
      form.set("promoFee", "");
      form.set("paymentWindowDays", "7");
      form.set("draftWindowDays", "14");
      form.set("correctionWindowDays", "14");
      form.set("inviteExpiryDays", "30");
      form.set("maxPhotos", "8");
      form.set("keywords", "");
      form.set("repeatThreshold", "3");
      // emailCodeRequired is omitted

      await saveSettingsForm(form, staffActor);
      const loaded = await loadSettingsForm();
      expect(loaded.emailCodeRequired).toBe(false);
    });

    it("present checkbox saves true", async () => {
      const form = new FormData();
      form.set("baseFee", "30");
      form.set("promoFee", "");
      form.set("paymentWindowDays", "7");
      form.set("draftWindowDays", "14");
      form.set("correctionWindowDays", "14");
      form.set("inviteExpiryDays", "30");
      form.set("maxPhotos", "8");
      form.set("emailCodeRequired", "on");
      form.set("keywords", "");
      form.set("repeatThreshold", "3");

      await saveSettingsForm(form, staffActor);
      const loaded = await loadSettingsForm();
      expect(loaded.emailCodeRequired).toBe(true);
    });
  });

  describe("AC: Keyword splitting and normalization", () => {
    it("splits keywords on newline", async () => {
      const form = new FormData();
      form.set("baseFee", "30");
      form.set("promoFee", "");
      form.set("paymentWindowDays", "7");
      form.set("draftWindowDays", "14");
      form.set("correctionWindowDays", "14");
      form.set("inviteExpiryDays", "30");
      form.set("maxPhotos", "8");
      form.set("keywords", "spam\nphishing\nscam");
      form.set("repeatThreshold", "3");

      await saveSettingsForm(form, staffActor);
      const loaded = await loadSettingsForm();
      expect(loaded.keywords).toBe("spam\nphishing\nscam");
    });

    it("splits keywords on comma", async () => {
      const form = new FormData();
      form.set("baseFee", "30");
      form.set("promoFee", "");
      form.set("paymentWindowDays", "7");
      form.set("draftWindowDays", "14");
      form.set("correctionWindowDays", "14");
      form.set("inviteExpiryDays", "30");
      form.set("maxPhotos", "8");
      form.set("keywords", "spam,phishing,scam");
      form.set("repeatThreshold", "3");

      await saveSettingsForm(form, staffActor);
      const loaded = await loadSettingsForm();
      // Keywords are stored deduplicated and lowercased, then joined on newline
      expect(loaded.keywords).toContain("spam");
      expect(loaded.keywords).toContain("phishing");
      expect(loaded.keywords).toContain("scam");
    });

    it("trims keywords and deduplicates", async () => {
      const form = new FormData();
      form.set("baseFee", "30");
      form.set("promoFee", "");
      form.set("paymentWindowDays", "7");
      form.set("draftWindowDays", "14");
      form.set("correctionWindowDays", "14");
      form.set("inviteExpiryDays", "30");
      form.set("maxPhotos", "8");
      form.set("keywords", "  SPAM  \n  spam  ");
      form.set("repeatThreshold", "3");

      await saveSettingsForm(form, staffActor);
      const loaded = await loadSettingsForm();
      expect(loaded.keywords).toBe("spam");
    });
  });

  describe("AC: Core field errors are mapped to form field names", () => {
    it("maps heldMessageRules errors to form field names", async () => {
      const form = new FormData();
      form.set("baseFee", "30");
      form.set("promoFee", "");
      form.set("paymentWindowDays", "7");
      form.set("draftWindowDays", "14");
      form.set("correctionWindowDays", "14");
      form.set("inviteExpiryDays", "30");
      form.set("maxPhotos", "8");
      form.set("keywords", "x".repeat(61)); // Too long
      form.set("repeatThreshold", "3");

      const { ok, fieldErrors } = await saveSettingsForm(form, staffActor);
      expect(ok).toBe(false);
      expect(fieldErrors).toHaveProperty("keywords");
    });

    it("maps repeatThreshold error to form field", async () => {
      const form = new FormData();
      form.set("baseFee", "30");
      form.set("promoFee", "");
      form.set("paymentWindowDays", "7");
      form.set("draftWindowDays", "14");
      form.set("correctionWindowDays", "14");
      form.set("inviteExpiryDays", "30");
      form.set("maxPhotos", "8");
      form.set("keywords", "");
      form.set("repeatThreshold", "25"); // Out of range

      const { ok, fieldErrors } = await saveSettingsForm(form, staffActor);
      expect(ok).toBe(false);
      expect(fieldErrors).toHaveProperty("repeatThreshold");
    });

    it("maps maxPhotos error to form field", async () => {
      const form = new FormData();
      form.set("baseFee", "30");
      form.set("promoFee", "");
      form.set("paymentWindowDays", "7");
      form.set("draftWindowDays", "14");
      form.set("correctionWindowDays", "14");
      form.set("inviteExpiryDays", "30");
      form.set("maxPhotos", "20"); // Out of range
      form.set("keywords", "");
      form.set("repeatThreshold", "3");

      const { ok, fieldErrors } = await saveSettingsForm(form, staffActor);
      expect(ok).toBe(false);
      expect(fieldErrors).toHaveProperty("maxPhotos");
    });
  });

  describe("SEC: loadSettingsForm exposes only the eleven form keys", () => {
    it("does not expose storefrontTokenEnc, GIDs, or rulesText", async () => {
      const loaded = await loadSettingsForm();

      expect(loaded).toHaveProperty("baseFee");
      expect(loaded).toHaveProperty("promoFee");
      expect(loaded).toHaveProperty("paymentWindowDays");
      expect(loaded).toHaveProperty("draftWindowDays");
      expect(loaded).toHaveProperty("correctionWindowDays");
      expect(loaded).toHaveProperty("inviteExpiryDays");
      expect(loaded).toHaveProperty("maxPhotos");
      expect(loaded).toHaveProperty("emailCodeRequired");
      expect(loaded).toHaveProperty("holdOnLinks");
      expect(loaded).toHaveProperty("keywords");
      expect(loaded).toHaveProperty("repeatThreshold");

      // These must not exist
      expect(loaded).not.toHaveProperty("storefrontTokenEnc");
      expect(loaded).not.toHaveProperty("feeProductGid");
      expect(loaded).not.toHaveProperty("rulesText");
      expect(loaded).not.toHaveProperty("rulesVersion");
      expect(loaded).not.toHaveProperty("alertsEnabled");
      expect(loaded).not.toHaveProperty("renewalsEnabled");
      expect(Object.keys(loaded)).toHaveLength(11);
    });
  });
});
