import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { mockSes } from "@/../tests/factories.js";
import {
  send,
  setSesClient,
  runScheduled,
} from "@/modules/notifications/index.js";
import { resetEmailProblems } from "@/modules/notifications/services/problems.js";
import { suppress } from "@/modules/notifications/services/suppression.js";

describe("Email send (AC + SEC)", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
    process.env.SES_FROM_TRANSACTIONAL = "transactional@example.test";
    process.env.SES_CONFIG_SET_TRANSACTIONAL = "tx-set";
    process.env.SES_FROM_ALERTS = "alerts@example.test";
    process.env.SES_CONFIG_SET_ALERTS = "alerts-set";
    process.env.OCP_POSTAL_ADDRESS = "123 Main St, Spokane WA";
    resetEmailProblems();
  });

  afterEach(() => {
    setSesClient(null);
    delete process.env.SES_FROM_TRANSACTIONAL;
    delete process.env.SES_CONFIG_SET_TRANSACTIONAL;
    delete process.env.SES_FROM_ALERTS;
    delete process.env.SES_CONFIG_SET_ALERTS;
    delete process.env.OCP_POSTAL_ADDRESS;
  });

  it("AC: suppressed address is skipped (no SES call, status SUPPRESSED)", async () => {
    const ses = mockSes();
    setSesClient(ses);
    await suppress("buyer@example.test", "BOUNCE");

    const result = await send("draft_reminder", "buyer@example.test", {
      seller_first_name: "Pat",
      seller_link: "https://example.test/pay",
    });

    expect(result.status).toBe("SUPPRESSED");
    expect(ses.sent).toHaveLength(0);
  });

  it("AC: transactional email sends HTML + text with right config set and sender", async () => {
    const ses = mockSes();
    setSesClient(ses);

    await send("draft_reminder", "seller@example.test", {
      seller_first_name: "Pat",
      seller_link: "https://example.test/pay",
    });

    expect(ses.sent).toHaveLength(1);
    const cmd = ses.sent[0].input;
    expect(cmd.FromEmailAddress).toContain("transactional@example.test");
    expect(cmd.ConfigurationSetName).toBe("tx-set");
    expect(cmd.Content.Simple.Subject.Data).toBeTruthy();
    expect(cmd.Content.Simple.Body.Html.Data).toContain("Pat");
    expect(cmd.Content.Simple.Body.Text.Data).toBeTruthy();
  });

  it("AC: alerts email includes List-Unsubscribe headers and postal address", async () => {
    const ses = mockSes();
    setSesClient(ses);

    await send("alerts_digest", "subscriber@example.test", {
      count: 1,
      browse_url: "https://example.test/browse",
      unsubscribe_link: "https://example.test/unsubscribe",
      listings: [],
    });

    expect(ses.sent).toHaveLength(1);
    const cmd = ses.sent[0].input;
    expect(cmd.FromEmailAddress).toContain("alerts@example.test");
    expect(cmd.ConfigurationSetName).toBe("alerts-set");
    const headers = cmd.Content.Simple.Headers || [];
    expect(headers.some((h) => h.Name === "List-Unsubscribe")).toBe(true);
    expect(cmd.Content.Simple.Body.Html.Data).toContain("123 Main St");
  });

  it("AC: replyTo is passed through", async () => {
    const ses = mockSes();
    setSesClient(ses);

    await send(
      "draft_reminder",
      "seller@example.test",
      {
        seller_first_name: "Pat",
        seller_link: "https://example.test/pay",
      },
      { replyTo: "buyer@example.test" },
    );

    expect(ses.sent).toHaveLength(1);
    expect(ses.sent[0].input.ReplyToAddresses).toEqual(["buyer@example.test"]);
  });

  it("AC: alerts send without unsubscribe_link is refused", async () => {
    setSesClient(mockSes());

    await expect(
      send("alerts_digest", "subscriber@example.test", {
        count: 1,
        browse_url: "https://example.test/browse",
        listings: [],
      }),
    ).rejects.toThrow();
  });

  it("AC: permanent failure → FAILED and EmailProblem audit", async () => {
    const ses = {
      send: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("rejected"), { name: "MessageRejected" }),
        ),
      sent: [],
    };
    setSesClient(ses);

    const result = await send("draft_reminder", "seller@example.test", {
      seller_first_name: "Pat",
      seller_link: "https://example.test/pay",
    });

    expect(result.status).toBe("FAILED");
    const audit = await prisma.auditEvent.findFirst({
      where: { action: "EmailProblem" },
    });
    expect(audit).toBeDefined();
    expect(audit.details.key).toContain("draft_reminder");
  });

  it("AC: same idempotencyKey twice → one SES call", async () => {
    const ses = mockSes();
    setSesClient(ses);

    const key = "idem-test";
    const first = await send(
      "draft_reminder",
      "seller@example.test",
      {
        seller_first_name: "Pat",
        seller_link: "https://example.test/pay",
      },
      { idempotencyKey: key },
    );

    const second = await send(
      "draft_reminder",
      "seller@example.test",
      {
        seller_first_name: "Pat",
        seller_link: "https://example.test/pay",
      },
      { idempotencyKey: key },
    );

    expect(first.outboxId).toBe(second.outboxId);
    expect(ses.sent).toHaveLength(1);
  });

  it("AC: send('invitation', ...) (copy-only) is refused", async () => {
    setSesClient(mockSes());

    await expect(
      send("invitation", "seller@example.test", {
        seller_first_name: "Pat",
        item_summary: "lantern",
        invitation_link: "https://example.test/invite",
        invitation_expiry_date: "October 10, 2026",
        staff_first_name: "Alex",
      }),
    ).rejects.toThrow();
  });

  it("AC: unknown template key is refused", async () => {
    setSesClient(mockSes());

    await expect(send("unknown", "seller@example.test", {})).rejects.toThrow();
  });

  it("AC: unknown placeholder is refused", async () => {
    setSesClient(mockSes());

    await expect(
      send("draft_reminder", "seller@example.test", {
        seller_first_name: "Pat",
        seller_link: "https://example.test/pay",
        nope: "should fail",
      }),
    ).rejects.toThrow();
  });

  it("AC: non-https link is refused", async () => {
    setSesClient(mockSes());

    await expect(
      send("draft_reminder", "seller@example.test", {
        seller_first_name: "Pat",
        seller_link: "http://example.test/pay",
      }),
    ).rejects.toThrow();
  });

  it("SEC: CRLF in listing_title is stripped from Subject", async () => {
    const ses = mockSes();
    setSesClient(ses);

    await send("staff_review_needed", "staff@example.test", {
      listing_title: "Lantern\r\nBcc: evil@example.test",
      review_link: "https://example.test/review",
      change_type: "new listing",
    });

    const subject = ses.sent[0].input.Content.Simple.Subject.Data;
    expect(subject).not.toContain("\r");
    expect(subject).not.toContain("\n");
  });

  it("SEC: CRLF in address is refused", async () => {
    setSesClient(mockSes());

    await expect(
      send("draft_reminder", "seller\r\n@example.test", {
        seller_first_name: "Pat",
        seller_link: "https://example.test/pay",
      }),
    ).rejects.toThrow();
  });

  const NOTICE = {
    listing_title: "Lantern",
    change_type: "new listing",
    review_link: "https://shop.example.test/app/listings/1",
  };
  const REMINDER = {
    payment_due_date: "October 12, 2026",
    pay_link: "https://shop.example.test/pay/secret-token",
  };
  const transient = () =>
    Object.assign(new Error("x"), { name: "ThrottlingException" });
  const HOUR = 3_600_000;

  it("AC: a temporary failure is queued, then sent by the hourly task", async () => {
    const ses = mockSes();
    setSesClient(ses);
    ses.send.mockRejectedValueOnce(transient());
    const now = new Date();

    const { status, outboxId } = await send(
      "staff_review_needed",
      "staff@example.test",
      NOTICE,
      { now },
    );
    expect(status).toBe("PENDING");
    const queued = await prisma.emailOutbox.findUnique({
      where: { id: outboxId },
    });
    expect(queued.vars).toEqual(NOTICE);
    expect(queued.lastErrorCode).toBe("ThrottlingException");

    // Not due yet: the first wait is five minutes.
    expect(await runScheduled({ now })).toMatchObject({ sent: 0 });
    const summary = await runScheduled({
      now: new Date(now.getTime() + HOUR),
    });
    expect(summary).toMatchObject({ sent: 1, pending: 0, failed: 0 });

    const sent = await prisma.emailOutbox.findUnique({
      where: { id: outboxId },
    });
    expect(sent).toMatchObject({ status: "SENT", attempts: 2, vars: null });
    expect(ses.sent).toHaveLength(1);
  });

  it("AC: after six failed tries the email is DEAD and a problem is recorded", async () => {
    const ses = mockSes();
    setSesClient(ses);
    ses.send.mockRejectedValue(transient());
    let now = new Date();

    const { outboxId } = await send(
      "staff_review_needed",
      "staff@example.test",
      NOTICE,
      { now },
    );
    for (let run = 0; run < 5; run += 1) {
      now = new Date(now.getTime() + 25 * HOUR);
      await runScheduled({ now });
    }

    const row = await prisma.emailOutbox.findUnique({
      where: { id: outboxId },
    });
    expect(row).toMatchObject({ status: "DEAD", attempts: 6, vars: null });
    expect(
      await prisma.auditEvent.count({ where: { action: "EmailProblem" } }),
    ).toBe(1);
    // A later run leaves it alone.
    await runScheduled({ now: new Date(now.getTime() + 25 * HOUR) });
    expect(ses.send).toHaveBeenCalledTimes(6);
  });

  it("SEC: an email with a private link is never stored and is retried on the spot", async () => {
    const ses = mockSes();
    setSesClient(ses);
    ses.send.mockRejectedValueOnce(transient());

    const { status, outboxId } = await send(
      "payment_reminder",
      "seller@example.test",
      REMINDER,
    );

    expect(status).toBe("SENT");
    expect(ses.send).toHaveBeenCalledTimes(2);
    const row = await prisma.emailOutbox.findUnique({
      where: { id: outboxId },
    });
    expect(row.vars).toBeNull();
    expect(
      await prisma.auditEvent.count({ where: { action: "EmailProblem" } }),
    ).toBe(0);
  });

  it("SEC: a failed email with a private link is FAILED, not queued, and stores nothing", async () => {
    const ses = mockSes();
    setSesClient(ses);
    ses.send.mockRejectedValue(transient());

    const { status, outboxId } = await send(
      "payment_reminder",
      "seller@example.test",
      REMINDER,
    );

    expect(status).toBe("FAILED");
    expect(ses.send).toHaveBeenCalledTimes(3);
    const row = await prisma.emailOutbox.findUnique({
      where: { id: outboxId },
    });
    expect(row.vars).toBeNull();
    expect(JSON.stringify(row)).not.toContain("secret-token");
    expect(
      await prisma.auditEvent.count({ where: { action: "EmailProblem" } }),
    ).toBe(1);
  });

  it("AC: without the stream's SES settings the email waits in the queue", async () => {
    const ses = mockSes();
    setSesClient(ses);
    delete process.env.SES_CONFIG_SET_TRANSACTIONAL;

    const { status } = await send(
      "staff_review_needed",
      "staff@example.test",
      NOTICE,
    );

    expect(status).toBe("PENDING");
    expect(ses.send).not.toHaveBeenCalled();
  });

  it("AC: finished rows are removed after 30 days", async () => {
    setSesClient(mockSes());
    const now = new Date();
    await send("staff_review_needed", "staff@example.test", NOTICE, { now });

    const summary = await runScheduled({
      now: new Date(now.getTime() + 31 * 24 * HOUR),
    });

    expect(summary.purged).toBe(1);
    expect(await prisma.emailOutbox.count()).toBe(0);
  });

  it.each([
    ["SOLD", "marked as sold"],
    ["EXPIRED", "listing month"],
    ["LAPSED", "paid for in time"],
    ["REMOVED", "has been removed"],
  ])("AC: the closed email explains a %s close", async (reason, phrase) => {
    const ses = mockSes();
    setSesClient(ses);

    await send("listing_closed", "seller@example.test", {
      seller_first_name: "Pat",
      listing_title: "Lantern",
      close_reason: reason,
    });

    expect(ses.sent[0].input.Content.Simple.Body.Text.Data).toContain(phrase);
  });

  it("SEC: a buyer message replies to the buyer and is never stored", async () => {
    const ses = mockSes();
    setSesClient(ses);

    const { outboxId } = await send(
      "buyer_message",
      "seller@example.test",
      {
        seller_first_name: "Pat",
        listing_title: "Lantern",
        buyer_name: "Sam\r\nBcc: evil@example.test",
        message: "Is it <b>still</b> available?",
      },
      { replyTo: "buyer@example.test" },
    );

    const { input } = ses.sent[0];
    expect(input.ReplyToAddresses).toEqual(["buyer@example.test"]);
    expect(input.Content.Simple.Subject.Data).not.toMatch(/[\r\n]/);
    expect(input.Content.Simple.Body.Html.Data).toContain(
      "&lt;b&gt;still&lt;/b&gt;",
    );
    const row = await prisma.emailOutbox.findUnique({
      where: { id: outboxId },
    });
    expect(row.vars).toBeNull();
  });
});
