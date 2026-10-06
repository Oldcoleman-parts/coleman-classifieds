import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing, mockS3, mockCloudFront } from "@/../tests/factories.js";
import {
  createUploadUrl,
  completeUpload,
  publish,
  setS3Client,
  setCloudFrontClient,
  setPresigner,
} from "@/modules/media/index.js";
import { unpublishClosed } from "@/modules/media/services/sweep.js";
import sharp from "sharp";

describe("Photo sweep (AC + SEC)", () => {
  let s3, cloudFront;

  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
    s3 = mockS3();
    setS3Client(s3);
    cloudFront = mockCloudFront();
    setCloudFrontClient(cloudFront);
    setPresigner(async (command, options) => {
      return `https://signed.example.test/${command.input.Key}?expires=${options.expiresIn}`;
    });
  });

  afterEach(() => {
    setS3Client(null);
    setCloudFrontClient(null);
    setPresigner(null);
  });

  async function uploadPhoto(listing, actor) {
    const jpeg = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: "#aabbcc",
      },
    })
      .jpeg()
      .toBuffer();

    const { photoId } = await createUploadUrl({
      listingId: listing.id,
      actor,
      contentType: "image/jpeg",
      byteSize: jpeg.length,
    });

    s3.objects.set(`incoming/${listing.id}/${photoId}`, {
      body: jpeg,
      contentType: "image/jpeg",
    });

    return completeUpload({ listingId: listing.id, photoId, actor });
  }

  describe("publish on closed listing", () => {
    it("AC3a: publish on closed listing writes nothing and returns []", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo = await uploadPhoto(listing, actor);

      // Approve the photo
      await prisma.photo.update({
        where: { id: photo.id },
        data: { approvedAt: new Date() },
      });

      // Close the listing without publishing
      await prisma.listing.update({
        where: { id: listing.id },
        data: { status: "EXPIRED", closedAt: new Date() },
      });

      // Clear S3 sent commands to track what happens next
      s3.sent.length = 0;

      // Try to publish closed listing
      const urls = await publish(listing.id);

      // Should return empty and write no PutObject commands
      expect(urls).toHaveLength(0);
      const putCommands = s3.sent.filter(
        (cmd) => cmd.constructor.name === "PutObjectCommand",
      );
      expect(putCommands).toHaveLength(0);
    });
  });

  describe("sweep", () => {
    it("AC3b: sweep unpublishes closed listing with public photos", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo = await uploadPhoto(listing, actor);

      // Approve and publish the photo
      await prisma.photo.update({
        where: { id: photo.id },
        data: { approvedAt: new Date() },
      });

      await publish(listing.id);

      // Verify photo is published
      let updated = await prisma.photo.findUnique({ where: { id: photo.id } });
      expect(updated.publicKeyBase).not.toBeNull();

      const publicObjectsBefore = Array.from(s3.objects.keys()).filter((k) =>
        k.startsWith("public/"),
      );
      expect(publicObjectsBefore.length).toBeGreaterThan(0);

      // Now close the listing (simulating a missed ListingClosed event)
      await prisma.listing.update({
        where: { id: listing.id },
        data: { status: "EXPIRED", closedAt: new Date() },
      });

      // Clear S3 sent to track what the sweep does
      s3.sent.length = 0;
      cloudFront.sent.length = 0;

      // Run the sweep
      const result = await unpublishClosed();

      // Should have found and cleaned the listing
      expect(result.checked).toBeGreaterThan(0);
      expect(result.listings).toBe(1);
      expect(result.unpublished).toBe(1);
      expect(result.failed).toBe(0);

      // Verify publicKeyBase is nulled
      updated = await prisma.photo.findUnique({ where: { id: photo.id } });
      expect(updated.publicKeyBase).toBeNull();

      // Verify public objects are deleted
      const publicObjectsAfter = Array.from(s3.objects.keys()).filter((k) =>
        k.startsWith("public/"),
      );
      expect(publicObjectsAfter).toHaveLength(0);

      // Verify an invalidation was sent
      const invalidations = cloudFront.sent.filter(
        (cmd) => cmd.constructor.name === "CreateInvalidationCommand",
      );
      expect(invalidations).toHaveLength(1);

      // Verify PhotosUnpublished audit was written
      const audits = await prisma.auditEvent.findMany({
        where: { listingId: listing.id, action: "PhotosUnpublished" },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].details).toEqual({ count: 1, by: "sweep" });
    });

    it("IDEM: second sweep sends nothing for already-cleaned listing", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo = await uploadPhoto(listing, actor);

      // Approve and publish
      await prisma.photo.update({
        where: { id: photo.id },
        data: { approvedAt: new Date() },
      });

      await publish(listing.id);

      // Close the listing
      await prisma.listing.update({
        where: { id: listing.id },
        data: { status: "EXPIRED", closedAt: new Date() },
      });

      // First sweep
      const result1 = await unpublishClosed();
      expect(result1.listings).toBe(1);

      // Clear sent commands
      s3.sent.length = 0;
      cloudFront.sent.length = 0;

      // Second sweep
      const result2 = await unpublishClosed();

      // Should find nothing to do (no photos with publicKeyBase)
      expect(result2.listings).toBe(0);
      expect(result2.unpublished).toBe(0);

      // Should send no commands
      const putCommands = s3.sent.filter(
        (cmd) => cmd.constructor.name === "PutObjectCommand",
      );
      const deleteCommands = s3.sent.filter(
        (cmd) => cmd.constructor.name === "DeleteObjectsCommand",
      );
      const invalidations = cloudFront.sent.filter(
        (cmd) => cmd.constructor.name === "CreateInvalidationCommand",
      );

      expect(putCommands).toHaveLength(0);
      expect(deleteCommands).toHaveLength(0);
      expect(invalidations).toHaveLength(0);
    });

    it("AC: LIVE listing is left alone", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo = await uploadPhoto(listing, actor);

      // Approve and publish
      await prisma.photo.update({
        where: { id: photo.id },
        data: { approvedAt: new Date() },
      });

      await publish(listing.id);

      // Set listing to LIVE (without closing it)
      await prisma.listing.update({
        where: { id: listing.id },
        data: {
          status: "LIVE",
          liveAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      const publicObjectsBefore = Array.from(s3.objects.keys()).filter((k) =>
        k.startsWith("public/"),
      );
      expect(publicObjectsBefore).toHaveLength(3);

      // Clear S3 sent to track what the sweep does
      s3.sent.length = 0;

      // Run the sweep
      const result = await unpublishClosed();

      // Should find 1 LIVE listing with public photos and do nothing
      expect(result.listings).toBe(0);

      // Verify public objects are still there
      const publicObjectsAfter = Array.from(s3.objects.keys()).filter((k) =>
        k.startsWith("public/"),
      );
      expect(publicObjectsAfter).toHaveLength(3);

      // Verify no delete commands were sent
      const deleteCommands = s3.sent.filter(
        (cmd) => cmd.constructor.name === "DeleteObjectsCommand",
      );
      expect(deleteCommands).toHaveLength(0);
    });
  });
});
