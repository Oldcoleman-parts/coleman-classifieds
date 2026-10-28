// F08-FIX-8: an erased buyer's HELD message can't be released, and nothing is sent for it.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ValidationError } from "@/modules/core/index.js";
import { eraseBuyer, release } from "@/modules/contact/index.js";
import { send } from "@/modules/notifications/index.js";
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
  STAFF,
  tearDown,
} from "./helpers.js";

const LINK_MESSAGE = "Cheap lanterns at https://spam.example/offer";

describe("Buyer contact: erased held messages (F08-FIX-8)", () => {
  let ses;

  beforeEach(async () => {
    ses = await freshWorld();
    await openListing();
  });

  afterEach(() => tearDown());

  it("AC: erase then release of a HELD message sends nothing and changes nothing else", async () => {
    await postForm(HANDLE, contactForm({ message: LINK_MESSAGE }));
    const [held] = await messageRows();
    expect(held.status).toBe("HELD");
    await eraseBuyer(BUYER_EMAIL);

    const sentBefore = ses.sent.length;
    const result = await release(held.id, STAFF);

    expect(result.changed).toBe(false);
    expect(ses.sent.length).toBe(sentBefore);
    expect(relayed(ses)).toHaveLength(0);
    expect(
      await prisma.emailOutbox.count({
        where: { templateKey: "buyer_message" },
      }),
    ).toBe(0);

    const [row] = await messageRows();
    expect(row).toMatchObject({
      status: "DISCARDED",
      buyerEmail: "",
      buyerName: "",
      body: "",
      ip: "",
      reviewedBy: null,
    });
    expect(row.reviewedAt).toBeInstanceOf(Date);
  });

  it("AC: a buyer_message without a reply-to is a ValidationError and nothing is stored", async () => {
    await expect(
      send("buyer_message", "pat.seller@example.test", {
        seller_first_name: "Pat",
        listing_title: "Lantern",
        buyer_name: "Sam",
        message: "Hello",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(
      await prisma.emailOutbox.count({
        where: { templateKey: "buyer_message" },
      }),
    ).toBe(0);
  });
});
