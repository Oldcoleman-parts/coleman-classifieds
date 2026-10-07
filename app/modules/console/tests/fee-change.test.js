import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { createInvitation } from "@/modules/access/index.js";
import { staffFromSession } from "@/modules/core/index.js";
import { loadReviewScreen, saveSettingsForm } from "@/modules/console/index.js";
import { setUp, tearDown, staffActor, STAFF } from "./helpers.js";

describe("F05-T2: Fee changes affect only new invitations", () => {
  beforeAll(async () => {
    await setUp();
  });

  beforeEach(async () => {
    await setUp();
  });

  afterEach(() => {
    tearDown();
  });

  it("AC: a fee change in Settings affects only new invitations", async () => {
    // Create invitation A and listing with current fees
    const { invitation: invitationA, listing: listingA } =
      await createInvitation(
        {
          sellerName: "Seller A",
          sellerEmail: "seller-a@example.test",
          itemSummary: "Coleman 220",
          feeOfferedCents: undefined,
        },
        staffFromSession(STAFF.session),
      );

    const feeA = invitationA.feeRegularCents;
    const feeOfferedA = invitationA.feeOfferedCents;

    // Change fees via Settings
    const settingsForm = new FormData();
    settingsForm.set("baseFee", "50.00");
    settingsForm.set("promoFee", "");
    settingsForm.set("paymentWindowDays", "7");
    settingsForm.set("draftWindowDays", "14");
    settingsForm.set("correctionWindowDays", "14");
    settingsForm.set("inviteExpiryDays", "30");
    settingsForm.set("maxPhotos", "8");
    settingsForm.set("keywords", "");
    settingsForm.set("repeatThreshold", "3");

    await saveSettingsForm(settingsForm, staffActor);

    // Create invitation B and listing with new fees
    const { listing: listingB } = await createInvitation(
      {
        sellerName: "Seller B",
        sellerEmail: "seller-b@example.test",
        itemSummary: "Coleman 285",
        feeOfferedCents: undefined,
      },
      staffFromSession(STAFF.session),
    );

    // Verify listing A still shows old fees in review screen
    const reviewA = await loadReviewScreen(listingA.id);
    expect(reviewA.seller.feeRegularCents).toBe(feeA);
    expect(reviewA.seller.feeOfferedCents).toBe(feeOfferedA);

    // Verify listing B shows new fees (5000 cents = $50.00)
    const reviewB = await loadReviewScreen(listingB.id);
    expect(reviewB.seller.feeRegularCents).toBe(5000);
  });
});
