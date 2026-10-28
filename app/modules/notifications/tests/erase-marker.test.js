// F08-FIX-8: an erased address that was suppressed stays suppressed, kept only as a hash.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { resetDb, prisma } from "@/../tests/db.js";
import { mockSes } from "@/../tests/factories.js";
import {
  eraseAddress,
  isSuppressed,
  send,
  setSesClient,
} from "@/modules/notifications/index.js";
import { suppress } from "@/modules/notifications/services/suppression.js";

const ADDRESS = "Bounced.Buyer@example.test";
const DRAFT = {
  seller_first_name: "Pat",
  seller_link: "https://example.test/pay",
};

describe("Email suppression survives an erase (F08-FIX-8)", () => {
  let ses;

  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
    process.env.SES_FROM_TRANSACTIONAL = "transactional@example.test";
    process.env.SES_CONFIG_SET_TRANSACTIONAL = "tx-set";
    ses = mockSes();
    setSesClient(ses);
  });

  afterEach(() => {
    setSesClient(null);
    delete process.env.SES_FROM_TRANSACTIONAL;
    delete process.env.SES_CONFIG_SET_TRANSACTIONAL;
  });

  it("AC: an erased suppressed address is still suppressed for a new send", async () => {
    await suppress(ADDRESS, "BOUNCE");
    await eraseAddress(ADDRESS);

    const result = await send("draft_reminder", ADDRESS, DRAFT);

    expect(result.status).toBe("SUPPRESSED");
    expect(ses.sent).toHaveLength(0);
    expect(await isSuppressed(ADDRESS)).toBe(true);
  });

  it("SEC: the marker holds a hash, never the plain address", async () => {
    await suppress(ADDRESS, "COMPLAINT");
    await eraseAddress(ADDRESS);

    const markers = await prisma.emailSuppressionMarker.findMany();
    expect(markers).toHaveLength(1);
    const expected = createHash("sha256")
      .update(ADDRESS.trim().toLowerCase() + process.env.TOKEN_PEPPER)
      .digest("hex");
    expect(markers[0].emailHash).toBe(expected);
    expect(JSON.stringify(markers)).not.toMatch(/bounced|@example\.test/i);
  });
});
