import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/../tests/db.js";
import { getSettings } from "@/modules/core/index.js";
import { loader as page } from "@/routes/proxy.seller.$token.jsx";
import { action as draft } from "@/routes/proxy.seller.$token_.draft.jsx";
import { action as start } from "@/routes/proxy.seller.$token_.start.jsx";
import { action as submit } from "@/routes/proxy.seller.$token_.submit.jsx";
import {
  call,
  COMPLETE,
  DAY_MS,
  listingOf,
  sellerWith,
  setUp,
  tearDown,
} from "./helpers.js";

const future = () => new Date(Date.now() + 7 * DAY_MS);
const past = () => new Date(Date.now() - 60_000);

describe("Preparing a listing (AC1, AC2)", () => {
  beforeEach(() => setUp());
  afterEach(tearDown);

  it("AC1: opening the link changes nothing; Start begins the draft once", async () => {
    const seller = await sellerWith({ status: "INVITED" });

    const body = await (await call(page, seller)).text();
    expect(body).toContain("Start my listing");
    expect((await listingOf(seller)).status).toBe("INVITED");

    await call(start, seller, {});
    const started = await listingOf(seller);
    await call(start, seller, {});

    expect(started.status).toBe("DRAFT");
    expect(started.draftDueBy.getTime()).toBeGreaterThan(Date.now());
    expect((await listingOf(seller)).draftDueBy).toEqual(started.draftDueBy);
    expect(
      (
        await prisma.invitation.findUnique({
          where: { id: seller.invitation.id },
        })
      ).status,
    ).toBe("USED");
  });

  it("AC1: a saved draft is there when the seller comes back", async () => {
    const seller = await sellerWith({ status: "DRAFT", draftDueBy: future() });

    const saved = await call(draft, seller, {
      title: "Coleman 220 stove",
      askingPrice: "$1,085.50",
      arrangementsShown: "1",
      arrangements: ["SHIPPING", "PICKUP"],
    });
    const body = await (await call(page, seller)).text();

    expect(saved.status).toBe(200);
    expect(await listingOf(seller)).toMatchObject({
      title: "Coleman 220 stove",
      askingPriceCents: 108550,
      arrangements: ["PICKUP", "SHIPPING"],
    });
    expect(body).toContain('value="Coleman 220 stove"');
  });

  it.each([
    ["DRAFT", { draftDueBy: past() }],
    ["CHANGES_REQUESTED", { correctionDueBy: past() }],
  ])(
    "AC1: after the %s deadline the closed page shows",
    async (status, due) => {
      const seller = await sellerWith({ status, ...due, title: "Before" });

      const shown = await (await call(page, seller)).text();
      const posted = await (
        await call(draft, seller, { title: "After it" })
      ).text();

      for (const body of [shown, posted])
        expect(body).toContain("The deadline for this listing has passed");
      expect((await listingOf(seller)).title).toBe("Before");
    },
  );

  it.each([
    ["the title is missing", { title: null }, {}],
    ["there is no photo", {}, { photos: [] }],
    ["the box is unticked", {}, { agree: null }],
    ["the rules version is stale", {}, { rulesVersion: "v0-old" }],
    ["OTHER has no note", { arrangements: ["OTHER"] }, {}],
  ])("AC2: submit is blocked when %s", async (_, fields, posted) => {
    const seller = await sellerWith(
      { status: "DRAFT", draftDueBy: future(), ...COMPLETE, ...fields },
      { photos: posted.photos ?? [false] },
    );
    const { rulesVersion } = await getSettings();
    const form = { agree: "on", rulesVersion, ...posted };
    delete form.photos;
    for (const key of Object.keys(form))
      if (form[key] === null) delete form[key];

    const response = await call(submit, seller, form);

    expect(response.status).toBe(422);
    expect((await listingOf(seller)).status).toBe("DRAFT");
    expect(await prisma.termsAcceptance.count()).toBe(0);
  });

  it("AC2: a complete submit records the rules version, time, IP and browser", async () => {
    const seller = await sellerWith(
      { status: "DRAFT", draftDueBy: future(), ...COMPLETE },
      { photos: [false] },
    );
    const { rulesVersion } = await getSettings();

    const response = await call(
      submit,
      seller,
      { agree: "on", rulesVersion },
      {
        headers: { "X-Forwarded-For": "203.0.113.9", "User-Agent": "Test/1.0" },
      },
    );

    expect(response.status).toBe(200);
    expect((await listingOf(seller)).status).toBe("SUBMITTED");
    const [acceptance] = await prisma.termsAcceptance.findMany();
    expect(acceptance).toMatchObject({
      listingId: seller.listing.id,
      rulesVersion,
      ip: "203.0.113.9",
      userAgent: "Test/1.0",
    });
    expect(acceptance.acceptedAt).toBeInstanceOf(Date);
    const audit = await prisma.auditEvent.findFirst({
      where: { listingId: seller.listing.id, action: "ListingSubmitted" },
    });
    expect(audit.details).toMatchObject({ kind: "NEW" });
  });
});
