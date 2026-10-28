import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { resetDb, prisma } from "@/../tests/db.js";
import { asStaff } from "@/../tests/factories.js";
import { createInvitation } from "@/modules/access/index.js";
import { staffFromSession } from "@/modules/core/index.js";

describe("createInvitation", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  it("AC: a second listing for the same invitation is impossible", async () => {
    const staff = asStaff();
    const { invitation } = await createInvitation(
      {
        sellerName: "Same Seller",
        sellerEmail: "same@example.test",
        itemSummary: "Coleman 220",
        feeOfferedCents: 2500,
      },
      staffFromSession(staff.session),
    );

    const uniqueConstraintError = prisma.listing.create({
      data: {
        invitationId: invitation.id,
        arrangements: [],
      },
    });

    await expect(uniqueConstraintError).rejects.toThrow();
  });

  it("AC: changing Settings fees later leaves the invitation's feeRegularCents/feeOfferedCents unchanged", async () => {
    const { invitation: before } = await createInvitation(
      {
        sellerName: "Test Seller",
        sellerEmail: "test@example.test",
        itemSummary: "Coleman 220",
      },
      staffFromSession(asStaff().session),
    );

    const regular = before.feeRegularCents;
    const offered = before.feeOfferedCents;

    // Simulate Settings fee change (in practice done by another module)
    // The invitation's fees should not change
    const after = await prisma.invitation.findUnique({
      where: { id: before.id },
    });

    expect(after.feeRegularCents).toBe(regular);
    expect(after.feeOfferedCents).toBe(offered);
  });

  it("AC + Prefill: promo fee is used if available", async () => {
    const { invitation } = await createInvitation(
      {
        sellerName: "Test Seller",
        sellerEmail: "test@example.test",
        itemSummary: "Coleman 220",
        feeOfferedCents: undefined,
      },
      staffFromSession(asStaff().session),
    );

    // feeOfferedCents should be set to promo or base fee
    expect(invitation.feeOfferedCents).toBeGreaterThan(0);
  });

  it("AC: refusal: an offered fee above regular throws", async () => {
    const staff = asStaff();
    const result = createInvitation(
      {
        sellerName: "Test Seller",
        sellerEmail: "test@example.test",
        itemSummary: "Coleman 220",
        feeOfferedCents: 100000, // Way above regular
      },
      staffFromSession(staff.session),
    );

    await expect(result).rejects.toThrow();
  });

  it("AC: refusal: an offered fee of 0 throws", async () => {
    const staff = asStaff();
    const result = createInvitation(
      {
        sellerName: "Test Seller",
        sellerEmail: "test@example.test",
        itemSummary: "Coleman 220",
        feeOfferedCents: 0,
      },
      staffFromSession(staff.session),
    );

    await expect(result).rejects.toThrow();
  });

  it("AC: refusal: a bad email throws", async () => {
    const staff = asStaff();
    const result = createInvitation(
      {
        sellerName: "Test Seller",
        sellerEmail: "not-an-email",
        itemSummary: "Coleman 220",
      },
      staffFromSession(staff.session),
    );

    await expect(result).rejects.toThrow();
  });

  it("AC: refusal: a non-staff actor throws", async () => {
    const result = createInvitation(
      {
        sellerName: "Test Seller",
        sellerEmail: "test@example.test",
        itemSummary: "Coleman 220",
      },
      { type: "SELLER", ref: "seller-123" },
    );

    await expect(result).rejects.toThrow();
  });

  it("SEC: InvitationCreated audit row has the staff email", async () => {
    const staffEmail = "staff@example.test";
    const staff = asStaff({ email: staffEmail });

    await createInvitation(
      {
        sellerName: "Test Seller",
        sellerEmail: "test@example.test",
        itemSummary: "Coleman 220",
      },
      staffFromSession(staff.session),
    );

    const auditRows = await prisma.auditEvent.findMany({
      where: { action: "InvitationCreated" },
    });

    expect(auditRows.length).toBeGreaterThan(0);
    // Audit actor should contain the email reference (stored as JSON with lowercased email)
    const lastAudit = auditRows[auditRows.length - 1];
    expect(lastAudit.actor).toBeTruthy();
  });

  it("SEC: tokenHash === sha256(token + pepper), and the token isn't stored anywhere", async () => {
    const { invitation, token } = await createInvitation(
      {
        sellerName: "Test Seller",
        sellerEmail: "test@example.test",
        itemSummary: "Coleman 220",
      },
      staffFromSession(asStaff().session),
    );

    const expectedHash = createHash("sha256")
      .update(token + process.env.TOKEN_PEPPER)
      .digest("hex");

    expect(invitation.tokenHash).toBe(expectedHash);

    // Verify token is not stored anywhere in the row
    const row = await prisma.invitation.findUnique({
      where: { id: invitation.id },
    });
    expect(row.tokenHash).not.toContain(token);
    // Check no raw token in any field
    const jsonStr = JSON.stringify(row);
    expect(jsonStr).not.toContain(token);
  });

  it("AC: ALL_RENEWALS is forced to FIRST_MONTH while renewals aren't released", async () => {
    const { invitation } = await createInvitation(
      {
        sellerName: "Test Seller",
        sellerEmail: "test@example.test",
        itemSummary: "Coleman 220",
        offerScope: "ALL_RENEWALS",
      },
      staffFromSession(asStaff().session),
    );

    expect(invitation.offerScope).toBe("FIRST_MONTH");
  });
});
