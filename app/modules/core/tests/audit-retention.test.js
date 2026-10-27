import { describe, it, expect, beforeAll } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import {
  getSettings,
  purgeExpiredAuditEntries,
  runAsPurgeRole,
} from "@/modules/core";

// AC (F01-FIX-11): the listing-less retention keeps PrivacyErased and privacy.* rows.
const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY);

describe("listing-less audit retention", () => {
  beforeAll(async () => {
    await resetDb();
    await getSettings();
    await prisma.auditEvent.createMany({
      data: [
        {
          id: "ret-erased",
          actor: "SYSTEM",
          action: "PrivacyErased",
          at: ago(400),
        },
        {
          id: "ret-redact",
          actor: "SYSTEM",
          action: "privacy.customers_redact",
          at: ago(400),
        },
        {
          id: "ret-other",
          actor: "SYSTEM",
          action: "PageRetireFailed",
          at: ago(400),
        },
      ],
    });
  });

  it("AC: old PrivacyErased and privacy.* rows stay; another old listing-less action is deleted", async () => {
    const deleted = await runAsPurgeRole((tx) =>
      purgeExpiredAuditEntries(tx, { keepRulesVersions: [] }),
    );

    expect(deleted).toBe(1);
    const left = await prisma.auditEvent.findMany({
      where: { id: { in: ["ret-erased", "ret-redact", "ret-other"] } },
      select: { id: true },
    });
    expect(left.map((row) => row.id).sort()).toEqual([
      "ret-erased",
      "ret-redact",
    ]);
  });
});
