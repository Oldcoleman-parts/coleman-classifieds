import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { makeListing } from "@/../tests/factories.js";
import { handleReviewAction } from "@/modules/console/index.js";
import {
  setUp,
  tearDown,
  staffActor,
  prisma,
  expectAuditedByStaff,
} from "./helpers.js";

describe("F05-T1: Photo actions", () => {
  beforeAll(async () => {
    await setUp();
  });

  beforeEach(async () => {
    await setUp();
  });

  afterEach(tearDown);

  it("AC: Set-main fails on LIVE listing", async () => {
    const listing = await makeListing({ status: "LIVE" });

    const photo = await prisma.photo.create({
      data: {
        id: "a1234567890abcdef1234567",
        listingId: listing.id,
        privateKey: "key",
        position: 0,
        uploadedBy: "SELLER",
      },
    });

    const form = new FormData();
    form.set("intent", "set-main");
    form.set("photoId", photo.id);

    const result = await handleReviewAction(listing.id, form, {
      actor: staffActor,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("can’t be changed");
  });

  it("AC: Order-photos fails on LIVE listing", async () => {
    const listing = await makeListing({ status: "LIVE" });

    const photo = await prisma.photo.create({
      data: {
        id: "a1234567890abcdef1234567",
        listingId: listing.id,
        privateKey: "key",
        position: 0,
        uploadedBy: "SELLER",
      },
    });

    const form = new FormData();
    form.set("intent", "order-photos");
    form.append("photoIds", photo.id);

    const result = await handleReviewAction(listing.id, form, {
      actor: staffActor,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("can’t be changed");
  });

  it("AC: Upload-url fails on LIVE listing", async () => {
    const listing = await makeListing({ status: "LIVE" });

    const form = new FormData();
    form.set("intent", "upload-url");
    form.set("contentType", "image/jpeg");
    form.set("byteSize", "1000000");

    const result = await handleReviewAction(listing.id, form, {
      actor: staffActor,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("can’t be changed");
  });

  it("AC: Photo actions work on SUBMITTED listing", async () => {
    const listing = await makeListing({ status: "SUBMITTED" });

    const photo = await prisma.photo.create({
      data: {
        id: "a1234567890abcdef1234567",
        listingId: listing.id,
        privateKey: "key",
        position: 0,
        uploadedBy: "SELLER",
      },
    });

    // Set main succeeds
    const form1 = new FormData();
    form1.set("intent", "set-main");
    form1.set("photoId", photo.id);

    const result1 = await handleReviewAction(listing.id, form1, {
      actor: staffActor,
    });
    expect(result1.ok).toBe(true);
  });

  it("AC: Delete-photo succeeds on LIVE listing", async () => {
    const listing = await makeListing({ status: "LIVE" });

    const photo = await prisma.photo.create({
      data: {
        id: "a1234567890abcdef1234567",
        listingId: listing.id,
        privateKey: "key",
        position: 0,
        uploadedBy: "SELLER",
      },
    });

    const form = new FormData();
    form.set("intent", "delete-photo");
    form.set("photoId", photo.id);

    const result = await handleReviewAction(listing.id, form, {
      actor: staffActor,
    });

    expect(result.ok).toBe(true);

    // Photo marked deleted
    const deleted = await prisma.photo.findUnique({
      where: { id: photo.id },
    });
    expect(deleted.deletedAt).not.toBeNull();
    await expectAuditedByStaff(listing.id, "PhotoDeleted");
  });
});
