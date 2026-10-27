// F08-FIX-8: a row deleted by a privacy erase while its email is being sent doesn't make
// `send()` throw; the send finishes without its row.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { mockSes } from "@/../tests/factories.js";
import { send, setSesClient } from "@/modules/notifications/index.js";

describe("Email send with an erase in flight (F08-FIX-8)", () => {
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
    delete process.env.SES_FROM_TRANSACTIONAL;
    delete process.env.SES_CONFIG_SET_TRANSACTIONAL;
  });

  it("AC: deleting the outbox row inside the SES send doesn't make send() throw", async () => {
    const ses = mockSes();
    const works = ses.send.getMockImplementation();
    ses.send.mockImplementation(async (command) => {
      // The erase runs now: the row being sent is removed.
      await prisma.emailOutbox.deleteMany({});
      return works(command);
    });
    setSesClient(ses);

    const result = await send("draft_reminder", "seller@example.test", {
      seller_first_name: "Pat",
      seller_link: "https://example.test/pay",
    });

    expect(ses.sent).toHaveLength(1);
    expect(result.status).toBe("SENT");
    expect(await prisma.emailOutbox.count()).toBe(0);
  });
});
