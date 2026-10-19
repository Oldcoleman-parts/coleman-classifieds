// F03-FIX-3: Settings → Emails previews use the app's real seller and pay routes.
import { describe, it, expect } from "vitest";
import { TEMPLATES } from "@/modules/notifications/registry.js";

/** Every string in a template's sample data, list items included. */
function sampleStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(sampleStrings);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(sampleStrings);
  return [];
}

describe("Registry sample links (F03-FIX-3)", () => {
  it("AC: no sample uses the old /apps/classifieds/i/ route", () => {
    for (const [key, def] of Object.entries(TEMPLATES)) {
      for (const text of sampleStrings(def.sample))
        expect(text, key).not.toContain("/apps/classifieds/i/");
    }
  });

  it("AC: seller links point at /apps/classifieds/seller/sample", () => {
    for (const [key, def] of Object.entries(TEMPLATES)) {
      for (const name of ["seller_link", "invitation_link"])
        if (def.sample?.[name])
          expect(def.sample[name], key).toBe(
            "https://oldcolemanparts.com/apps/classifieds/seller/sample",
          );
    }
  });

  it("AC: pay links point at the pay page /apps/classifieds/pay/<ref>", () => {
    const withPay = Object.entries(TEMPLATES).filter(
      ([, def]) => def.sample?.pay_link,
    );
    expect(withPay.map(([key]) => key).sort()).toEqual([
      "approved_pay",
      "payment_reminder",
    ]);
    for (const [, def] of withPay)
      expect(def.sample.pay_link).toBe(
        "https://oldcolemanparts.com/apps/classifieds/pay/sample",
      );
  });
});
