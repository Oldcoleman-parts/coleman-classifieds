import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { makeListing, mockSes } from "@/../tests/factories.js";
import { handleReviewAction } from "@/modules/console/index.js";
import { setSesClient } from "@/modules/notifications/index.js";
import {
  setUp,
  tearDown,
  staffActor,
  prisma,
  expectAuditedByStaff,
} from "./helpers.js";

describe("F05-T1: Revision decisions", () => {
  beforeAll(async () => {
    await setUp();
  });

  beforeEach(async () => {
    await setUp();
  });

  afterEach(tearDown);

  it("AC: Approve-revision keeps expiresAt identical", async () => {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const listing = await makeListing({
      status: "LIVE",
      title: "Original",
      description: "Original description",
      expiresAt,
    });

    // A wording-only change that passes the seller form's field rules
    const revision = await prisma.listingRevision.create({
      data: {
        listingId: listing.id,
        status: "PENDING",
        changes: {
          title: "Updated lantern",
          description: "A new description of the 1951 lantern.",
        },
        photoIds: [],
      },
    });

    const form = new FormData();
    form.set("intent", "approve-revision");
    form.set("revisionId", revision.id);

    // Import bootstrap to register workspace listener
    await import("@/bootstrap.server.js");

    const result = await handleReviewAction(listing.id, form, {
      actor: staffActor,
    });

    expect(result.ok).toBe(true);

    // Title/description copied (via workspace listener)
    const updated = await prisma.listing.findUnique({
      where: { id: listing.id },
    });
    expect(updated.title).toBe("Updated lantern");
    expect(updated.expiresAt.getTime()).toBe(expiresAt.getTime());

    // Revision approved
    const revisionUpdated = await prisma.listingRevision.findUnique({
      where: { id: revision.id },
    });
    expect(revisionUpdated.status).toBe("APPROVED");
    await expectAuditedByStaff(listing.id, "RevisionApproved");
  });

  it("AC: Approve-revision with photoIds not in revision fails", async () => {
    const listing = await makeListing({ status: "LIVE" });

    const photo1 = await prisma.photo.create({
      data: {
        id: "a1234567890abcdef1234567",
        listingId: listing.id,
        privateKey: "key",
        position: 0,
        uploadedBy: "SELLER",
      },
    });

    const revision = await prisma.listingRevision.create({
      data: {
        listingId: listing.id,
        status: "PENDING",
        changes: {},
        photoIds: ["otherPhotoId"],
      },
    });

    const form = new FormData();
    form.set("intent", "approve-revision");
    form.set("revisionId", revision.id);
    form.append("photoIds", photo1.id); // Not in revision.photoIds

    const result = await handleReviewAction(listing.id, form, {
      actor: staffActor,
    });

    expect(result.ok).toBe(false);
    expect(result.fieldErrors.photoIds).toBeDefined();

    // Revision still PENDING
    const rev = await prisma.listingRevision.findUnique({
      where: { id: revision.id },
    });
    expect(rev.status).toBe("PENDING");
  });

  it("AC: Reject-revision sends email without listing_rejected", async () => {
    const ses = mockSes();
    setSesClient(ses);

    const listing = await makeListing({
      status: "LIVE",
      invitation: { sellerEmail: "seller@test.local" },
    });

    const revision = await prisma.listingRevision.create({
      data: {
        listingId: listing.id,
        status: "PENDING",
        changes: { title: "New title" },
        photoIds: [],
      },
    });

    const form = new FormData();
    form.set("intent", "reject-revision");
    form.set("revisionId", revision.id);
    form.set("note", "Please try again");

    const getLinkUrl = async () =>
      "https://example.test/apps/classifieds/my-link";

    const result = await handleReviewAction(listing.id, form, {
      actor: staffActor,
      getLinkUrl,
    });

    expect(result.ok).toBe(true);

    // Email sent with revision_rejected key
    expect(ses.sent).toHaveLength(1);
    expect(ses.sent[0].input.Destination.ToAddresses).toEqual([
      "seller@test.local",
    ]);
    const outbox = await prisma.emailOutbox.findMany();
    expect(outbox.map((row) => row.templateKey)).toEqual(["revision_rejected"]);

    // Revision rejected
    const revisionUpdated = await prisma.listingRevision.findUnique({
      where: { id: revision.id },
    });
    expect(revisionUpdated.status).toBe("REJECTED");
    await expectAuditedByStaff(listing.id, "RevisionRejected");
  });

  it("AC: Wrong revisionId fails", async () => {
    const listing = await makeListing({ status: "LIVE" });

    await prisma.listingRevision.create({
      data: { listingId: listing.id, status: "PENDING", changes: {} },
    });

    const form = new FormData();
    form.set("intent", "approve-revision");
    form.set("revisionId", "wrong-id");
    form.append("photoIds", "");

    const result = await handleReviewAction(listing.id, form, {
      actor: staffActor,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("already been decided");
  });

  it("AC: Already-decided revisionId fails", async () => {
    const listing = await makeListing({ status: "LIVE" });

    const revision = await prisma.listingRevision.create({
      data: { listingId: listing.id, status: "APPROVED", changes: {} },
    });

    const form = new FormData();
    form.set("intent", "approve-revision");
    form.set("revisionId", revision.id);
    form.append("photoIds", "");

    const result = await handleReviewAction(listing.id, form, {
      actor: staffActor,
    });

    expect(result.ok).toBe(false);
  });

  it("AC: Revision cannot be decided on non-LIVE listing", async () => {
    const listing = await makeListing({ status: "PAUSED" });

    const revision = await prisma.listingRevision.create({
      data: { listingId: listing.id, status: "PENDING", changes: {} },
    });

    // The review screen shows decideRevision:false for paused, but test the action
    const form = new FormData();
    form.set("intent", "approve-revision");
    form.set("revisionId", revision.id);
    form.append("photoIds", "");

    const result = await handleReviewAction(listing.id, form, {
      actor: staffActor,
    });

    expect(result.ok).toBe(false);
  });
});
