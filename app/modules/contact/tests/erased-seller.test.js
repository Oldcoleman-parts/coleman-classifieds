// F08-FIX-8: a LIVE listing whose seller was erased (`redacted+<id>@invalid`) takes no
// buyer message: the send fails cleanly and the buyer's row is not kept.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getSellerContacts } from "@/modules/access/index.js";
import {
  contactForm,
  freshWorld,
  HANDLE,
  messageRows,
  openListing,
  postForm,
  prisma,
  relayed,
  tearDown,
} from "./helpers.js";

describe("Buyer contact: erased seller (F08-FIX-8)", () => {
  let ses;
  let listing;

  beforeEach(async () => {
    ses = await freshWorld();
    listing = await openListing({
      invitation: {
        sellerEmail: "redacted+cltestid@invalid",
        sellerName: "Redacted",
      },
    });
  });

  afterEach(() => tearDown());

  it("AC: a buyer message to an erased seller's LIVE listing fails and leaves no buyer row", async () => {
    const response = await postForm(HANDLE, contactForm());
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("Your message has been sent");

    expect(relayed(ses)).toHaveLength(0);
    expect(await messageRows()).toHaveLength(0);
  });

  it("SEC: an erased seller is left out of getSellerContacts", async () => {
    const row = await prisma.listing.findUniqueOrThrow({
      where: { id: listing.id },
    });
    const contacts = await getSellerContacts([row.id]);
    expect(contacts.has(row.id)).toBe(false);
  });
});
