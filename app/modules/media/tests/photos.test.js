import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing, mockS3, mockCloudFront } from "@/../tests/factories.js";
import {
  createUploadUrl,
  completeUpload,
  reorder,
  setMain,
  deletePhoto,
  publish,
  setS3Client,
  setCloudFrontClient,
  setPresigner,
} from "@/modules/media/index.js";
import sharp from "sharp";
import { ValidationError, NotFoundError } from "@/modules/core/index.js";

describe("Photo management (AC + SEC)", () => {
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

  describe("reorder", () => {
    it("AC: changes order and writes PhotosReordered audit", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo1 = await uploadPhoto(listing, actor);
      const photo2 = await uploadPhoto(listing, actor);
      const photo3 = await uploadPhoto(listing, actor);

      // Reorder to 3, 1, 2
      await reorder(listing.id, [photo3.id, photo1.id, photo2.id], actor);

      const photos = await prisma.photo.findMany({
        where: { listingId: listing.id },
        orderBy: { position: "asc" },
      });

      expect(photos[0].id).toBe(photo3.id);
      expect(photos[0].position).toBe(0);
      expect(photos[1].id).toBe(photo1.id);
      expect(photos[1].position).toBe(1);
      expect(photos[2].id).toBe(photo2.id);
      expect(photos[2].position).toBe(2);

      const audit = await prisma.auditEvent.findFirst({
        where: { action: "PhotosReordered", listingId: listing.id },
      });
      expect(audit).toBeDefined();
    });

    it("AC: missing photoId throws ValidationError and changes nothing", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo1 = await uploadPhoto(listing, actor);
      await uploadPhoto(listing, actor);

      const originalOrder = await prisma.photo.findMany({
        where: { listingId: listing.id },
        orderBy: { position: "asc" },
      });

      await expect(
        reorder(listing.id, [photo1.id, "z".repeat(24)], actor),
      ).rejects.toThrow(ValidationError);

      const afterOrder = await prisma.photo.findMany({
        where: { listingId: listing.id },
        orderBy: { position: "asc" },
      });

      expect(afterOrder.map((p) => p.id)).toEqual(
        originalOrder.map((p) => p.id),
      );
    });

    it("AC: duplicate photoId throws ValidationError and changes nothing", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo1 = await uploadPhoto(listing, actor);
      await uploadPhoto(listing, actor);

      const originalOrder = await prisma.photo.findMany({
        where: { listingId: listing.id },
        orderBy: { position: "asc" },
      });

      await expect(
        reorder(listing.id, [photo1.id, photo1.id], actor),
      ).rejects.toThrow(ValidationError);

      const afterOrder = await prisma.photo.findMany({
        where: { listingId: listing.id },
        orderBy: { position: "asc" },
      });

      expect(afterOrder.map((p) => p.id)).toEqual(
        originalOrder.map((p) => p.id),
      );
    });

    it("AC: photoId from another listing throws ValidationError", async () => {
      const listing1 = await makeListing({ status: "DRAFT" });
      const listing2 = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo1a = await uploadPhoto(listing1, actor);
      await uploadPhoto(listing1, actor);
      const photo2 = await uploadPhoto(listing2, actor);

      await expect(
        reorder(listing1.id, [photo1a.id, photo2.id], actor),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("setMain", () => {
    it("AC: moves photo to position 0 keeping others' order", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo1 = await uploadPhoto(listing, actor);
      const photo2 = await uploadPhoto(listing, actor);
      const photo3 = await uploadPhoto(listing, actor);

      // Make photo3 the main
      await setMain(listing.id, photo3.id, actor);

      const photos = await prisma.photo.findMany({
        where: { listingId: listing.id },
        orderBy: { position: "asc" },
      });

      expect(photos[0].id).toBe(photo3.id);
      expect(photos[1].id).toBe(photo1.id);
      expect(photos[2].id).toBe(photo2.id);
    });

    it("AC: throws NotFoundError for unknown photo", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      await uploadPhoto(listing, actor);

      const unknownPhotoId = "a".repeat(24);
      await expect(setMain(listing.id, unknownPhotoId, actor)).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe("deletePhoto", () => {
    it("AC: removes private object, sets deletedAt, closes position gap, writes PhotoDeleted", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo1 = await uploadPhoto(listing, actor);
      await uploadPhoto(listing, actor);
      await uploadPhoto(listing, actor);

      const privateKey1 = photo1.privateKey;
      expect(s3.objects.has(privateKey1)).toBe(true);

      await deletePhoto(listing.id, photo1.id, actor);

      // Private object should be removed
      expect(s3.objects.has(privateKey1)).toBe(false);

      // Photo row should have deletedAt
      const deleted = await prisma.photo.findUnique({
        where: { id: photo1.id },
      });
      expect(deleted.deletedAt).not.toBeNull();

      // Remaining photos should have positions 0, 1 (gap closed)
      const remaining = await prisma.photo.findMany({
        where: { listingId: listing.id, deletedAt: null },
        orderBy: { position: "asc" },
      });
      expect(remaining).toHaveLength(2);
      expect(remaining[0].position).toBe(0);
      expect(remaining[1].position).toBe(1);

      const audit = await prisma.auditEvent.findFirst({
        where: { action: "PhotoDeleted", listingId: listing.id },
      });
      expect(audit).toBeDefined();
      expect(audit.details.photoId).toBe(photo1.id);
    });

    it("AC: is a no-op when called twice", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo = await uploadPhoto(listing, actor);

      await deletePhoto(listing.id, photo.id, actor);

      const auditsBefore = await prisma.auditEvent.findMany({
        where: { action: "PhotoDeleted", listingId: listing.id },
      });

      // Second delete (should be no-op)
      await deletePhoto(listing.id, photo.id, actor);

      const auditsAfter = await prisma.auditEvent.findMany({
        where: { action: "PhotoDeleted", listingId: listing.id },
      });

      // Same number of audits
      expect(auditsAfter).toHaveLength(auditsBefore.length);
    });

    it("AC: for published photo, removes public objects and sends invalidation", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo1 = await uploadPhoto(listing, actor);
      await uploadPhoto(listing, actor);

      // Approve both photos
      await prisma.photo.updateMany({
        where: { listingId: listing.id },
        data: { approvedAt: new Date() },
      });

      await publish(listing.id);

      const publicObjectsBefore = Array.from(s3.objects.keys()).filter((k) =>
        k.startsWith("public/"),
      );
      expect(publicObjectsBefore.length).toBeGreaterThan(0);

      cloudFront.sent.length = 0;
      await deletePhoto(listing.id, photo1.id, actor);

      const publicObjectsAfter = Array.from(s3.objects.keys()).filter((k) =>
        k.startsWith("public/"),
      );

      // Should have 3 fewer objects (photo1's thumb, medium, large)
      expect(publicObjectsAfter.length).toBe(publicObjectsBefore.length - 3);

      // Should have sent an invalidation
      const invalidations = cloudFront.sent.filter(
        (cmd) => cmd.constructor.name === "CreateInvalidationCommand",
      );
      expect(invalidations).toHaveLength(1);
    });

    it("AC: throws NotFoundError for unknown photo", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const unknownPhotoId = "a".repeat(24);
      await expect(
        deletePhoto(listing.id, unknownPhotoId, actor),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
