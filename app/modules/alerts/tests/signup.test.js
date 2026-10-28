import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { suppress } from "@/modules/notifications/services/suppression.js";
import { hashToken } from "@/modules/alerts/services/tokens.js";
import {
  activeSubscriber,
  captureLogs,
  confirmGet,
  confirmPost,
  confirmTokenFor,
  freshWorld,
  pendingSubscriber,
  prisma,
  rowFor,
  setTurnstile,
  signUp,
  tearDown,
  unsubscribeNow,
  sentTo,
  uniqueIp,
} from "./helpers.js";

const CHECKED = "Check your email";
const TOO_MANY = "Please wait a moment";

describe("Signup (F07-T2) security", () => {
  let ses;

  beforeEach(async () => {
    ses = await freshWorld();
  });

  afterEach(tearDown);

  it("SEC: the same response for new, pending, active, unsubscribed and suppressed addresses", async () => {
    await pendingSubscriber(ses, "pending@example.test");
    await activeSubscriber(ses, "active@example.test");
    await activeSubscriber(ses, "gone@example.test");
    await unsubscribeNow("gone@example.test");
    await suppress("bounced@example.test", "COMPLAINT");

    const emails = [
      "new@example.test",
      "pending@example.test",
      "active@example.test",
      "gone@example.test",
      "bounced@example.test",
    ];
    const replies = [];
    for (const email of emails) {
      const res = await signUp(email);
      replies.push({ status: res.status, body: await res.text() });
    }

    expect(replies[0].body).toContain(CHECKED);
    expect(replies.every((r) => r.status === 200)).toBe(true);
    expect(new Set(replies.map((r) => r.body)).size).toBe(1);
  });

  it.each([
    ["the honeypot is filled", { website: "http://spam.example" }],
    ["Turnstile fails", { token: "bad" }],
    ["the Turnstile field is missing", { token: null }],
  ])("SEC: when %s, nothing is stored or sent", async (_, options) => {
    if (options.token === "bad") setTurnstile(false);
    await signUp("bot@example.test", options);

    expect(await prisma.alertSubscriber.count()).toBe(0);
    expect(ses.sent).toHaveLength(0);
  });

  it("SEC: the per-IP limit stops a flood of signups from one address", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 10; i += 1)
      await signUp(`flood-${i}@example.test`, { ip });
    const res = await signUp("flood-11@example.test", { ip });

    expect(await res.text()).toContain(TOO_MANY);
    expect(await prisma.alertSubscriber.count()).toBe(10);
  });

  it("SEC: the per-address limit stops a fourth signup in a day", async () => {
    const email = "repeat@example.test";
    for (let i = 0; i < 3; i += 1) await signUp(email);
    const res = await signUp(email);

    expect(await res.text()).toContain(TOO_MANY);
    expect(ses.sent).toHaveLength(3);
  });

  it("SEC: a token is stored only as its hash", async () => {
    await signUp("hash@example.test");
    const token = confirmTokenFor(ses, "hash@example.test");
    const row = await rowFor("hash@example.test");

    expect(row.confirmTokenHash).toBe(hashToken(token));
    expect(row.confirmTokenHash).not.toContain(token);
    expect(row.unsubscribeTokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("SEC: a tampered token gets the same neutral page as an unknown one", async () => {
    await signUp("tamper@example.test");
    const token = confirmTokenFor(ses, "tamper@example.test");
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

    const bad = await (await confirmPost(tampered)).text();
    const unknown = await (await confirmPost("nope")).text();

    expect(bad).toBe(unknown);
    expect((await rowFor("tamper@example.test")).confirmedAt).toBeNull();
  });

  it("SEC: no token or pepper reaches the logs", async () => {
    const logs = captureLogs();
    await signUp("logs@example.test");
    const token = confirmTokenFor(ses, "logs@example.test");
    await confirmGet(token);
    await confirmPost("nope");
    await confirmPost(token);

    expect(logs()).not.toContain(token);
    expect(logs()).not.toContain("test-pepper");
    expect(sentTo(ses, "logs@example.test")).toHaveLength(1);
    vi.restoreAllMocks();
  });
});
