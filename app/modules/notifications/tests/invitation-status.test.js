import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { resetDb } from "@/../tests/db.js";
import { mockSes } from "@/../tests/factories.js";
import {
  getEmailStatus,
  send,
  setSesClient,
} from "@/modules/notifications/index.js";
import { templateDef } from "@/modules/notifications/registry.js";

const ADDRESS = "pat@example.test";
const VARS = {
  seller_first_name: "Pat",
  item_summary: "lantern",
  invitation_link: "https://example.test/apps/classifieds/seller/x",
  invitation_expiry_date: "November 4, 2026",
  staff_first_name: "Alex",
};

describe("Invitation email template and status read (F04-FIX-3)", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
    process.env.SES_FROM_TRANSACTIONAL = "transactional@example.test";
    process.env.SES_CONFIG_SET_TRANSACTIONAL = "tx-set";
  });

  afterEach(() => {
    setSesClient(null);
  });

  it("AC: the invitation template is sent, not copy-only, and stays sensitive", () => {
    const def = templateDef("invitation");

    expect(def.copyOnly).toBeFalsy();
    expect(def.sensitive).toBe(true);
    expect(def.sample.invitation_link).toBe(
      "https://oldcolemanparts.com/apps/classifieds/seller/sample",
    );
  });

  it("AC: getEmailStatus returns only the status and the time, never the address or data", async () => {
    setSesClient(mockSes());
    const key = "invitation:test-status";
    await send("invitation", ADDRESS, VARS, { idempotencyKey: key });

    const status = await getEmailStatus(key);

    expect(Object.keys(status).sort()).toEqual(["at", "status"]);
    expect(status.status).toBe("SENT");
    expect(status.at).toBeInstanceOf(Date);
    expect(JSON.stringify(status)).not.toContain(ADDRESS);
  });

  it.each([
    ["an unknown key", "invitation:missing"],
    ["an empty key", ""],
    ["a key longer than 200 characters", "x".repeat(201)],
  ])("AC: getEmailStatus returns null for %s", async (_, key) => {
    expect(await getEmailStatus(key)).toBeNull();
  });
});
