import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing, mockS3, mockCloudFront } from "@/../tests/factories.js";
import {
  createUploadUrl,
  completeUpload,
  publish,
  runScheduled,
  setS3Client,
  setCloudFrontClient,
  setPresigner,
} from "@/modules/media/index.js";
import { getSettings } from "@/modules/core/index.js";
import sharp from "sharp";

describe("Photo retention (RET)", () => {
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

  describe("runRetention", () => {
    it("RET: listing closed 89 days ago keeps its photos", async () => {
      const now = new Date();
      const eightyNineDaysAgo = new Date(
        now.getTime() - 89 * 24 * 60 * 60 * 1000,
      );

      // Create listing as DRAFT, upload photos, then close it
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo = await uploadPhoto(listing, actor);

      // Update listing to EXPIRED with closedAt set
      await prisma.listing.update({
        where: { id: listing.id },
        data: { status: "EXPIRED", closedAt: eightyNineDaysAgo },
      });

      const settings = await getSettings();
      const retention = settings.photoRetentionDays;
      expect(retention).toBe(90); // Default

      const result = await runScheduled({ now });

      expect(result.purged).toBe(0);

      const deletedPhoto = await prisma.photo.findUnique({
        where: { id: photo.id },
      });
      expect(deletedPhoto.deletedAt).toBeNull();

      // Private object should still exist
      expect(s3.objects.has(photo.privateKey)).toBe(true);
    });

    it("RET: listing closed 90 days + 1 minute ago gets purged", async () => {
      const now = new Date();
      const cutoffTime = new Date(
        now.getTime() - 90 * 24 * 60 * 60 * 1000 - 60 * 1000,
      );

      // Create listing as DRAFT, upload photos, then close it
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo = await uploadPhoto(listing, actor);

      // Update listing to EXPIRED with closedAt set
      await prisma.listing.update({
        where: { id: listing.id },
        data: { status: "EXPIRED", closedAt: cutoffTime },
      });
      const privateKey = photo.privateKey;

      expect(s3.objects.has(privateKey)).toBe(true);

      const result = await runScheduled({ now });

      expect(result.listings).toBe(1);
      expect(result.purged).toBe(1);

      // Private object should be deleted
      expect(s3.objects.has(privateKey)).toBe(false);

      // Photo row should have deletedAt set
      const deletedPhoto = await prisma.photo.findUnique({
        where: { id: photo.id },
      });
      expect(deletedPhoto.deletedAt).not.toBeNull();

      // Audit event should exist
      const audit = await prisma.auditEvent.findFirst({
        where: { action: "PhotosPurged", listingId: listing.id },
      });
      expect(audit).toBeDefined();
      expect(audit.details.count).toBe(1);
    });

    it("RET: multiple photos in one listing get purged together", async () => {
      const now = new Date();
      const cutoffTime = new Date(
        now.getTime() - 90 * 24 * 60 * 60 * 1000 - 60 * 1000,
      );

      // Create listing as DRAFT, upload photos, then close it
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      await uploadPhoto(listing, actor);
      await uploadPhoto(listing, actor);

      // Update listing to EXPIRED with closedAt set
      await prisma.listing.update({
        where: { id: listing.id },
        data: { status: "EXPIRED", closedAt: cutoffTime },
      });

      const result = await runScheduled({ now });

      expect(result.listings).toBe(1);
      expect(result.purged).toBe(2);

      const audit = await prisma.auditEvent.findFirst({
        where: { action: "PhotosPurged", listingId: listing.id },
      });
      expect(audit.details.count).toBe(2);
    });

    it("RET: published photos also get their public objects removed", async () => {
      const now = new Date();
      const cutoffTime = new Date(
        now.getTime() - 90 * 24 * 60 * 60 * 1000 - 60 * 1000,
      );

      // Create listing as DRAFT, upload photos, then close it
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      await uploadPhoto(listing, actor);

      // Publish the photo first
      await publish(listing.id);

      // Update listing to EXPIRED with closedAt set
      await prisma.listing.update({
        where: { id: listing.id },
        data: { status: "EXPIRED", closedAt: cutoffTime },
      });

      const publicObjectsBefore = Array.from(s3.objects.keys()).filter((k) =>
        k.startsWith("public/"),
      );
      expect(publicObjectsBefore.length).toBeGreaterThan(0);

      await runScheduled({ now });

      const publicObjectsAfter = Array.from(s3.objects.keys()).filter((k) =>
        k.startsWith("public/"),
      );
      expect(publicObjectsAfter).toHaveLength(0);
    });

    it("RET: open listing is untouched", async () => {
      const listing = await makeListing({ status: "LIVE" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo = await uploadPhoto(listing, actor);

      const result = await runScheduled();

      expect(result.purged).toBe(0);

      const photoAfter = await prisma.photo.findUnique({
        where: { id: photo.id },
      });
      expect(photoAfter.deletedAt).toBeNull();
      expect(s3.objects.has(photo.privateKey)).toBe(true);
    });

    it("RET: running retention again purges nothing", async () => {
      const now = new Date();
      const cutoffTime = new Date(
        now.getTime() - 90 * 24 * 60 * 60 * 1000 - 60 * 1000,
      );

      // Create listing as DRAFT, upload photos, then close it
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      await uploadPhoto(listing, actor);

      // Update listing to EXPIRED with closedAt set
      await prisma.listing.update({
        where: { id: listing.id },
        data: { status: "EXPIRED", closedAt: cutoffTime },
      });

      const result1 = await runScheduled({ now });
      expect(result1.purged).toBe(1);

      const result2 = await runScheduled({ now });
      expect(result2.purged).toBe(0);
    });

    it("RET: uses default photoRetentionDays of 90 days", async () => {
      const now = new Date();
      // Verify default retention is 90 days
      const settings = await getSettings();
      expect(settings.photoRetentionDays).toBe(90);

      const ninetyOneDaysAgo = new Date(
        now.getTime() - 91 * 24 * 60 * 60 * 1000,
      );

      // Create listing as DRAFT, upload photos, then close it
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo = await uploadPhoto(listing, actor);

      // Update listing to EXPIRED with closedAt set
      await prisma.listing.update({
        where: { id: listing.id },
        data: { status: "EXPIRED", closedAt: ninetyOneDaysAgo },
      });

      const result = await runScheduled({ now });

      expect(result.purged).toBe(1);
      const deletedPhoto = await prisma.photo.findUnique({
        where: { id: photo.id },
      });
      expect(deletedPhoto.deletedAt).not.toBeNull();
    });
  });
});
