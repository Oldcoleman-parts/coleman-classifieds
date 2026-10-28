import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  contactForm,
  freshWorld,
  getForm,
  HANDLE,
  messageRows,
  openListing,
  postForm,
  prisma,
  relayed,
  setTurnstile,
  tearDown,
  uniqueIp,
} from "./helpers.js";

const CLOSED = "no longer available";
const TOO_MANY = "too many messages";

describe("Buyer contact: guards (F07-T1)", () => {
  let ses;

  beforeEach(async () => {
    ses = await freshWorld();
    // Repeat-sender holds would hide the limits under test: keep them out of the way.
    await prisma.settings.update({
      where: { id: 1 },
      data: {
        heldMessageRules: { holdOnLinks: true, keywords: [], repeatThreshold: 100 },
      },
    });
  });

  afterEach(() => tearDown());

  /** Nothing stored and nothing sent. */
  const expectNothingSent = async () => {
    expect(await messageRows()).toHaveLength(0);
    expect(relayed(ses)).toHaveLength(0);
  };

  it.each([
    ["Cloudflare says the check failed", { success: false }],
    ["Cloudflare can't be reached", { success: null }],
  ])(
    "SEC: a failed Turnstile check (%s) stores and sends nothing",
    async (_what, answer) => {
      await openListing();
      setTurnstile(answer);
      const response = await postForm(HANDLE, contactForm());
      expect(await response.text()).toContain("security check");
      await expectNothingSent();
    },
  );

  it("SEC: a missing Turnstile token stores and sends nothing", async () => {
    await openListing();
    await postForm(HANDLE, contactForm({ "cf-turnstile-response": "" }));
    await expectNothingSent();
  });

  it("SEC: a filled honeypot looks like success but stores and sends nothing", async () => {
    await openListing();
    const response = await postForm(
      HANDLE,
      contactForm({ website: "https://spam.example" }),
    );
    expect(await response.text()).toContain("Your message has been sent");
    await expectNothingSent();
  });

  it.each([
    [
      "IP",
      10,
      (i) => ({ ip: "198.51.100.9", email: `buyer${i}@example.test` }),
    ],
    ["email", 5, () => ({ ip: uniqueIp(), email: "repeat@example.test" })],
    [
      "listing",
      20,
      (i) => ({ ip: uniqueIp(), email: `buyer${i}@example.test` }),
    ],
  ])(
    "SEC: over the per-%s limit a message is refused",
    async (_limit, allowed, who) => {
      await openListing();
      for (let i = 0; i < allowed; i++) {
        const { ip, email } = who(i);
        await postForm(HANDLE, contactForm({ email }), { ip });
      }
      expect(await messageRows()).toHaveLength(allowed);

      const { ip, email } = who(allowed);
      const response = await postForm(HANDLE, contactForm({ email }), { ip });
      expect(await response.text()).toContain(TOO_MANY);
      expect(await messageRows()).toHaveLength(allowed);
      expect(relayed(ses)).toHaveLength(allowed);
    },
  );

  it.each([
    ["LIVE but past its end date", { expiresAt: new Date(Date.now() - 1000) }],
    ["SOLD", { status: "SOLD" }],
    ["PAUSED", { status: "PAUSED" }],
  ])(
    "SEC: a closed listing (%s) refuses the form and the message",
    async (_what, overrides) => {
      await openListing(overrides);
      const page = await getForm(HANDLE);
      expect(await page.text()).toContain(CLOSED);

      const response = await postForm(HANDLE, contactForm());
      expect(await response.text()).toContain(CLOSED);
      await expectNothingSent();
    },
  );

  it.each([
    ["an unknown handle", "no-such-listing"],
    ["a malformed handle", "Lantern X"],
  ])("SEC: %s is refused with no row", async (_what, handle) => {
    await openListing();
    const response = await postForm(handle, contactForm());
    expect(await response.text()).toContain(CLOSED);
    await expectNothingSent();
    expect(await prisma.buyerMessage.count()).toBe(0);
  });
});
