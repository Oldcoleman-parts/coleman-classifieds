import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { makeListing, mockSes } from "@/../tests/factories.js";
import { handleReviewAction } from "@/modules/console/index.js";
import { setSesClient } from "@/modules/notifications/index.js";
import {
  setUp,
  tearDown,
  STAFF,
  staffActor,
  prisma,
  expectAuditedByStaff,
} from "./helpers.js";

describe("F05-T1: Review decisions", () => {
  beforeAll(async () => {
    await setUp();
  });

  beforeEach(async () => {
    await setUp();
  });

  afterEach(tearDown);

  it("AC: Request changes audited with staff email and sends email with my-link URL", async () => {
    const ses = mockSes();
    setSesClient(ses);

    const listing = await makeListing({
      status: "SUBMITTED",
      invitation: { sellerEmail: "seller@test.local" },
    });

    const form = new FormData();
    form.set("intent", "request-changes");
    form.set("note", "Please provide more details");

    const getLinkUrl = vi.fn(
      async () => "https://example.test/apps/classifieds/my-link",
    );

    const result = await handleReviewAction(listing.id, form, {
      actor: staffActor,
      getLinkUrl,
    });

    expect(result.ok).toBe(true);

    // Status changed to CHANGES_REQUESTED
    const updated = await prisma.listing.findUnique({
      where: { id: listing.id },
    });
    expect(updated.status).toBe("CHANGES_REQUESTED");
    expect(updated.correctionDueBy).not.toBeNull();

    // Audit event with staff email
    const audit = await prisma.auditEvent.findFirst({
      where: {
        listingId: listing.id,
        details: { path: ["transition"], equals: "REQUEST_CHANGES" },
      },
    });
    expect(audit).toBeDefined();
    expect(audit.actorRef).toBe(STAFF.session.email);

    // Email sent with my-link URL, no seller link
    expect(ses.sent).toHaveLength(1);
    const emailBody = JSON.stringify(ses.sent[0].input);
    expect(emailBody).toContain("my-link");
    expect(emailBody).not.toContain("/apps/classifieds/seller/");
  });

  it("AC: Request changes fails without note", async () => {
    const listing = await makeListing({ status: "SUBMITTED" });

    const form = new FormData();
    form.set("intent", "request-changes");
    form.set("note", "");

    const result = await handleReviewAction(listing.id, form, {
      actor: staffActor,
    });

    expect(result.ok).toBe(false);
    expect(result.fieldErrors.note).toBeDefined();

    // Status unchanged
    const current = await prisma.listing.findUnique({
      where: { id: listing.id },
    });
    expect(current.status).toBe("SUBMITTED");
  });

  it("AC: Reject fails without reason; succeeds with reason", async () => {
    const listing = await makeListing({ status: "SUBMITTED" });

    const form = new FormData();
    form.set("intent", "reject");
    form.set("note", "");

    const result = await handleReviewAction(listing.id, form, {
      actor: staffActor,
    });

    expect(result.ok).toBe(false);
    expect(result.fieldErrors.note).toBeDefined();

    // Reject with reason
    const form2 = new FormData();
    form2.set("intent", "reject");
    form2.set("note", "Does not meet guidelines");

    const result2 = await handleReviewAction(listing.id, form2, {
      actor: staffActor,
    });

    expect(result2.ok).toBe(true);

    // Status is REJECTED
    const updated = await prisma.listing.findUnique({
      where: { id: listing.id },
    });
    expect(updated.status).toBe("REJECTED");
    await expectAuditedByStaff(listing.id, "ListingRejected");
  });

  it("AC: Reject closes invitation (via access listener)", async () => {
    const listing = await makeListing({ status: "SUBMITTED" });

    const form = new FormData();
    form.set("intent", "reject");
    form.set("note", "Violation of rules");

    // Import bootstrap to register listeners
    await import("@/bootstrap.server.js");

    const result = await handleReviewAction(listing.id, form, {
      actor: staffActor,
    });

    expect(result.ok).toBe(true);

    // Invitation status should be CLOSED
    const invitation = await prisma.invitation.findUnique({
      where: { id: listing.invitationId },
    });
    expect(invitation.status).toBe("CLOSED");

    // No charges
    const charges = await prisma.feeCharge.findMany({
      where: { listingId: listing.id },
    });
    expect(charges).toHaveLength(0);
  });

  it("AC: Approve audited; fails with photo from other listing", async () => {
    const listing = await makeListing({ status: "SUBMITTED" });
    const other = await makeListing({ status: "SUBMITTED" });

    const photo1 = await prisma.photo.create({
      data: {
        id: "a1234567890abcdef1234567",
        listingId: listing.id,
        privateKey: "key",
        position: 0,
        uploadedBy: "SELLER",
      },
    });

    const photo2 = await prisma.photo.create({
      data: {
        id: "b2234567890abcdef1234567",
        listingId: other.id,
        privateKey: "key2",
        position: 0,
        uploadedBy: "SELLER",
      },
    });

    // Try approving with photo from other listing
    const form = new FormData();
    form.set("intent", "approve");
    form.append("photoIds", photo2.id);

    const result = await handleReviewAction(listing.id, form, {
      actor: staffActor,
    });

    expect(result.ok).toBe(false);
    expect(result.fieldErrors.photoIds).toBeDefined();

    // Approve with own photos
    const form2 = new FormData();
    form2.set("intent", "approve");
    form2.append("photoIds", photo1.id);

    const result2 = await handleReviewAction(listing.id, form2, {
      actor: staffActor,
    });

    expect(result2.ok).toBe(true);

    const updated = await prisma.listing.findUnique({
      where: { id: listing.id },
    });
    expect(updated.status).toBe("APPROVED_AWAITING_PAYMENT");

    // Audit recorded
    const audit = await prisma.auditEvent.findFirst({
      where: { listingId: listing.id, action: "ListingApproved" },
    });
    expect(audit.actorRef).toBe(STAFF.session.email);
  });

  it("SEC: Action without staff ref throws", async () => {
    const listing = await makeListing({ status: "SUBMITTED" });

    const form = new FormData();
    form.set("intent", "reject");
    form.set("note", "test");

    // Actor without ref is invalid
    await expect(
      handleReviewAction(listing.id, form, { actor: { type: "STAFF" } }),
    ).rejects.toThrow("needs the staff email");

    // Nothing changed
    const current = await prisma.listing.findUnique({
      where: { id: listing.id },
    });
    expect(current.status).toBe("SUBMITTED");
  });

  it("AC: Edit-wording audited with field names only, only while SUBMITTED", async () => {
    const listing = await makeListing({
      status: "SUBMITTED",
      title: "Coleman",
      description: "A great lantern",
    });

    const form = new FormData();
    form.set("intent", "edit-wording");
    form.set("title", "Coleman Lantern");
    form.set("description", "A wonderful 1951 lantern in great condition");

    const result = await handleReviewAction(listing.id, form, {
      actor: staffActor,
    });

    expect(result.ok).toBe(true);

    // Updated
    const updated = await prisma.listing.findUnique({
      where: { id: listing.id },
    });
    expect(updated.title).toBe("Coleman Lantern");
    expect(updated.description).toContain("1951");

    // Audit with field names only
    const audit = await prisma.auditEvent.findFirst({
      where: { listingId: listing.id, action: "StaffWordingEdited" },
    });
    expect(audit.actorRef).toBe(STAFF.session.email);
    expect(audit.details.fields).toEqual(
      expect.arrayContaining(["title", "description"]),
    );
    // No text stored
    expect(JSON.stringify(audit.details)).not.toContain("Coleman");
  });

  it("AC: Edit-wording fails on LIVE listing", async () => {
    const listing = await makeListing({
      status: "LIVE",
      title: "Original",
      description: "Original description",
    });

    const form = new FormData();
    form.set("intent", "edit-wording");
    form.set("title", "Changed");
    form.set("description", "Changed description of the lantern");

    const result = await handleReviewAction(listing.id, form, {
      actor: staffActor,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("only be edited during review");

    // Unchanged
    const current = await prisma.listing.findUnique({
      where: { id: listing.id },
    });
    expect(current.title).toBe("Original");
  });

  it("AC: Edit-wording rejects < in title", async () => {
    const listing = await makeListing({ status: "SUBMITTED" });

    const form = new FormData();
    form.set("intent", "edit-wording");
    form.set("title", "Coleman <script> lantern");
    form.set("description", "A great lantern in good condition");

    const result = await handleReviewAction(listing.id, form, {
      actor: staffActor,
    });

    expect(result.ok).toBe(false);
    expect(result.fieldErrors.title).toContain("<");
  });
});
