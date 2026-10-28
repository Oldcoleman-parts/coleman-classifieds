import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  BUYER_EMAIL,
  contactForm,
  freshWorld,
  getForm,
  HANDLE,
  messageRows,
  openListing,
  postForm,
  prisma,
  relayed,
  SELLER_EMAIL,
  tearDown,
} from "./helpers.js";

describe("Buyer contact: relay (F07-T1)", () => {
  let ses;

  beforeEach(async () => {
    ses = await freshWorld();
    await openListing();
  });

  afterEach(() => tearDown());

  it("AC: a normal message reaches the seller with ReplyTo the buyer, and the row is DELIVERED with the SES id", async () => {
    const response = await postForm(HANDLE, contactForm());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Your message has been sent");

    const sent = relayed(ses);
    expect(sent).toHaveLength(1);
    expect(sent[0].input.ReplyToAddresses).toEqual([BUYER_EMAIL]);

    const [row] = await messageRows();
    expect(row.status).toBe("DELIVERED");
    expect(row.sesMessageId).toBe("test-1");
  });

  it("AC: the seller's email never appears in the form page or the sent page", async () => {
    const form = await (await getForm(HANDLE)).text();
    const sentPage = await (await postForm(HANDLE, contactForm())).text();
    for (const html of [form, sentPage]) {
      expect(html).not.toContain(SELLER_EMAIL);
      expect(html).not.toContain("Pat Seller");
    }
  });

  it("SEC: CRLF in the name is stripped, so no header can carry it", async () => {
    await postForm(
      HANDLE,
      contactForm({ name: "Sam\r\nBcc: evil@example.test" }),
    );
    const [row] = await messageRows();
    expect(row.buyerName).not.toMatch(/[\r\n]/);

    const [command] = relayed(ses);
    const headers = JSON.stringify([
      command.input.ReplyToAddresses,
      command.input.Content.Simple.Subject,
      command.input.FromEmailAddress,
    ]);
    expect(headers).not.toMatch(/\\r|\\n|[\r\n]/);
    expect(command.input.Destination.ToAddresses).toEqual([SELLER_EMAIL]);
  });

  it("SEC: an email with CR or LF is refused: no row, no send", async () => {
    const response = await postForm(
      HANDLE,
      contactForm({ email: `${BUYER_EMAIL}\r\nBcc: evil@example.test` }),
    );
    expect(await response.text()).toContain("Please check your name");
    expect(await messageRows()).toHaveLength(0);
    expect(relayed(ses)).toHaveLength(0);
  });

  it("SEC: a SES failure on a normal message leaves no row and shows the retry notice", async () => {
    ses.down = true;
    const response = await postForm(HANDLE, contactForm());
    expect(await response.text()).toContain(
      "couldn’t send your message right now",
    );
    expect(await messageRows()).toHaveLength(0);
    expect(relayed(ses)).toHaveLength(0);

    ses.down = false;
    expect(await (await postForm(HANDLE, contactForm())).text()).toContain(
      "Your message has been sent",
    );
    expect(
      await prisma.buyerMessage.count({ where: { status: "DELIVERED" } }),
    ).toBe(1);
  });
});
