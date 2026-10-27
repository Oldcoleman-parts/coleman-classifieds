import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { asStaff, makeListing } from "@/../tests/factories.js";
import { getSettings, staffFromSession } from "@/modules/core/index.js";
import {
  loadCreateInvitationScreen,
  submitCreateInvitation,
} from "../services/screens.js";

// The Create invitation form, as the seller-facing staff screen posts it.
const form = (overrides = {}) => {
  const data = new FormData();
  const values = {
    sellerName: "Screen Seller",
    sellerEmail: "screen@example.test",
    sellerPhone: "",
    itemSummary: "Coleman 200A lantern",
    offeredFee: "",
    offerScope: "",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

describe("Create invitation screen (F01-FIX-4)", () => {
  const staff = asStaff();
  const actor = staffFromSession(staff.session);
  const shopify = { admin: staff.admin, shop: staff.session.shop };

  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  it("AC: an offered fee of 25.50 creates an invitation at 2550 cents", async () => {
    const result = await submitCreateInvitation(
      form({ offeredFee: "25.50" }),
      actor,
      shopify,
    );

    expect(result.ok).toBe(true);
    const invitation = await prisma.invitation.findUniqueOrThrow({
      where: { id: result.invitationId },
    });
    expect(invitation.feeOfferedCents).toBe(2550);
  });

  it("AC: an offered fee of 30.555 is a field error and creates nothing", async () => {
    const result = await submitCreateInvitation(
      form({ offeredFee: "30.555" }),
      actor,
      shopify,
    );

    expect(result.ok).toBe(false);
    expect(result.fieldErrors.offeredFee).toBe(
      "must be an amount such as 30.00",
    );
    expect(await prisma.invitation.count()).toBe(0);
    expect(await prisma.listing.count()).toBe(0);
  });

  it("AC: an empty offered fee uses the default fee", async () => {
    const settings = await getSettings();
    const expected = settings.promoFeeCents ?? settings.baseFeeCents;

    const result = await submitCreateInvitation(form(), actor, shopify);

    expect(result.ok).toBe(true);
    const invitation = await prisma.invitation.findUniqueOrThrow({
      where: { id: result.invitationId },
    });
    expect(invitation.feeOfferedCents).toBe(expected);
  });

  it("AC: the loader returns the regular and offered fees as dollar strings", async () => {
    await prisma.settings.deleteMany();
    await getSettings();
    await prisma.settings.update({
      where: { id: 1 },
      data: { baseFeeCents: 3000, promoFeeCents: 1550 },
    });

    const screen = await loadCreateInvitationScreen(
      new URL("https://app.example.test/app/invitations/new"),
    );

    expect(screen.regularFee).toBe("30.00");
    expect(screen.offeredFee).toBe("15.50");
    expect(screen.historyEmail).toBe(null);
  });

  it("AC: the loader lists the seller's earlier listings for the email, in any case", async () => {
    await makeListing({
      title: "Coleman 220",
      status: "LIVE",
      invitation: { sellerEmail: "repeat@example.test" },
    });
    await makeListing({ invitation: { sellerEmail: "repeat@example.test" } });
    await makeListing({ invitation: { sellerEmail: "other@example.test" } });

    const screen = await loadCreateInvitationScreen(
      new URL(
        "https://app.example.test/app/invitations/new?email=%20Repeat@Example.test",
      ),
    );

    expect(screen.history).toHaveLength(2);
    expect(screen.historyEmail).toBe("repeat@example.test");
    expect(screen.history.map((row) => row.status).sort()).toEqual([
      "INVITED",
      "LIVE",
    ]);
  });

  it("rows belong to the email named above them: an invalid email gives no history", async () => {
    await makeListing({ invitation: { sellerEmail: "repeat@example.test" } });

    const screen = await loadCreateInvitationScreen(
      new URL(
        "https://app.example.test/app/invitations/new?email=not-an-email",
      ),
    );

    expect(screen.historyEmail).toBe(null);
    expect(screen.history).toEqual([]);
  });
});
