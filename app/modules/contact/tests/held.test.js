import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConflictError } from "@/modules/core/index.js";
import {
  handleMessageAction,
  setMessageProvider,
} from "@/modules/console/index.js";
import { discard, listHeld, release } from "@/modules/contact/index.js";
import {
  BUYER_EMAIL,
  contactForm,
  freshWorld,
  HANDLE,
  messageRows,
  openListing,
  postForm,
  prisma,
  relayed,
  sentTo,
  STAFF,
  STAFF_EMAIL,
  tearDown,
} from "./helpers.js";

const LINK_MESSAGE = "Cheap lanterns at https://spam.example/offer";

/** Submit a message with a link and return the held row. */
async function heldMessage(message = LINK_MESSAGE) {
  await postForm(HANDLE, contactForm({ message }));
  const [row] = await messageRows();
  return row;
}

describe("Buyer contact: held messages (F07-T1)", () => {
  let ses;
  let listing;

  beforeEach(async () => {
    ses = await freshWorld();
    listing = await openListing();
  });

  afterEach(() => {
    setMessageProvider(null);
    tearDown();
  });

  it("AC: a message with a link is held: no seller email, staff emailed with a /app/messages link, BuyerMessageHeld audited", async () => {
    const response = await postForm(
      HANDLE,
      contactForm({ message: LINK_MESSAGE }),
    );
    expect(await response.text()).toContain("Your message has been sent");

    const [row] = await messageRows();
    expect(row.status).toBe("HELD");
    expect(row.holdReasons).toEqual(["LINK"]);
    expect(relayed(ses)).toHaveLength(0);

    const notices = sentTo(ses, STAFF_EMAIL);
    expect(notices).toHaveLength(1);
    expect(notices[0].input.Content.Simple.Body.Text.Data).toMatch(
      /https:\/\/\S+\/app\/messages/,
    );

    const audits = await prisma.auditEvent.findMany({
      where: { action: "BuyerMessageHeld", listingId: listing.id },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toBe("BUYER");
  });

  it.each([
    ["a scheme", "see https://spam.example"],
    ["www.", "go to www.spam.example today"],
    ["a bare domain with a path", "bit.example.com/offer"],
  ])("SEC: a link written as %s is held", async (_form, message) => {
    await postForm(HANDLE, contactForm({ message }));
    const [row] = await messageRows();
    expect(row.status).toBe("HELD");
    expect(row.holdReasons).toContain("LINK");
  });

  it.each([
    ["a keyword", { keywords: ["crypto"] }, "Do you take CRYPTO?", "KEYWORD"],
    ["the repeat threshold", {}, "Still interested?", "REPEAT"],
  ])("AC: %s holds the message", async (_what, rules, message, reason) => {
    await prisma.settings.update({
      where: { id: 1 },
      data: {
        heldMessageRules: {
          holdOnLinks: true,
          keywords: [],
          repeatThreshold: 3,
          ...rules,
        },
      },
    });
    if (reason === "REPEAT")
      await prisma.buyerMessage.createMany({
        data: [1, 2, 3].map((n) => ({
          listingId: listing.id,
          buyerName: "Sam Buyer",
          buyerEmail: BUYER_EMAIL,
          body: `earlier ${n}`,
          ip: "198.51.100.1",
          status: "DELIVERED",
          holdReasons: [],
        })),
      });

    await postForm(HANDLE, contactForm({ message }));
    const held = await prisma.buyerMessage.findFirst({
      where: { body: message },
    });
    expect(held.status).toBe("HELD");
    expect(held.holdReasons).toEqual([reason]);
    expect(relayed(ses)).toHaveLength(0);
  });

  it("AC: release delivers once: two concurrent releases send one buyer_message", async () => {
    const row = await heldMessage();
    const results = await Promise.all([
      release(row.id, STAFF),
      release(row.id, STAFF),
    ]);
    expect(results.filter((result) => result.changed)).toHaveLength(1);
    expect(relayed(ses)).toHaveLength(1);
    expect(relayed(ses)[0].input.ReplyToAddresses).toEqual([BUYER_EMAIL]);
  });

  it("AC: a repeat release returns changed: false and sends nothing more", async () => {
    const row = await heldMessage();
    expect((await release(row.id, STAFF)).changed).toBe(true);
    expect((await release(row.id, STAFF)).changed).toBe(false);
    expect(relayed(ses)).toHaveLength(1);
  });

  it("AC: discard never delivers, and a release after discard sends nothing", async () => {
    const row = await heldMessage();
    expect((await discard(row.id, STAFF)).changed).toBe(true);
    expect((await release(row.id, STAFF)).changed).toBe(false);
    expect(relayed(ses)).toHaveLength(0);
    const [stored] = await messageRows();
    expect(stored.status).toBe("DISCARDED");
  });

  it("SEC: when SES fails the release reverts to HELD and throws; a later release sends once", async () => {
    const row = await heldMessage();
    ses.down = true;
    await expect(release(row.id, STAFF)).rejects.toBeInstanceOf(ConflictError);
    const [held] = await messageRows();
    expect(held.status).toBe("HELD");
    expect(relayed(ses)).toHaveLength(0);

    ses.down = false;
    expect((await release(row.id, STAFF)).changed).toBe(true);
    expect(relayed(ses)).toHaveLength(1);
  });

  it("AC: the staff screen's release is audited once and a repeat is not", async () => {
    const row = await heldMessage();
    setMessageProvider({ listHeld, release, discard });
    const form = () => {
      const data = new FormData();
      data.set("intent", "release");
      data.set("messageId", row.id);
      return data;
    };

    expect(await handleMessageAction(form(), STAFF)).toMatchObject({
      ok: true,
      already: false,
    });
    expect(await handleMessageAction(form(), STAFF)).toMatchObject({
      ok: true,
      already: true,
    });

    expect(relayed(ses)).toHaveLength(1);
    const audits = await prisma.auditEvent.findMany({
      where: { action: "HeldMessageReleased", listingId: listing.id },
    });
    expect(audits).toHaveLength(1);
  });
});
