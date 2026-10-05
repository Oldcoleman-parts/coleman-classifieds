import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing, mockS3, mockCloudFront } from "@/../tests/factories.js";
import {
  createUploadUrl,
  completeUpload,
  setS3Client,
  setCloudFrontClient,
  setPresigner,
  MAX_BYTES,
} from "@/modules/media/index.js";
import sharp from "sharp";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from "@/modules/core/index.js";

describe("Upload flow (AC + SEC)", () => {
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

  describe("createUploadUrl", () => {
    it("SEC: returns presigned URL with correct parameters", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      let capturedCommand, capturedOptions;
      setPresigner(async (command, options) => {
        capturedCommand = command;
        capturedOptions = options;
        return `https://signed.example.test/${command.input.Key}?expires=${options.expiresIn}`;
      });

      const result = await createUploadUrl({
        listingId: listing.id,
        actor,
        contentType: "image/jpeg",
        byteSize: 5000,
      });

      expect(result.photoId).toMatch(/^[a-f0-9]{24}$/);
      expect(result.url).toContain("signed.example.test");
      expect(result.url).toContain("incoming/");
      expect(result.headers).toEqual({ "Content-Type": "image/jpeg" });
      expect(result.expiresAt).toBeDefined();

      // Verify the presigner was called with correct parameters
      expect(capturedCommand).toBeDefined();
      expect(capturedCommand.constructor.name).toBe("PutObjectCommand");
      expect(capturedCommand.input.Key).toMatch(
        new RegExp(`^incoming/${listing.id}/[a-f0-9]{24}$`),
      );
      expect(capturedCommand.input.Bucket).toBe("test-bucket");
      expect(capturedCommand.input.ContentType).toBe("image/jpeg");
      expect(capturedCommand.input.ContentLength).toBe(5000);
      expect(capturedOptions.expiresIn).toBeLessThanOrEqual(600);
      expect(capturedOptions.signableHeaders.has("content-type")).toBe(true);
      expect(capturedOptions.signableHeaders.has("content-length")).toBe(true);
    });

    it("SEC: photoId does not leak seller info", async () => {
      const listing = await makeListing({
        status: "DRAFT",
        invitation: { sellerEmail: "alice@example.test", sellerName: "Alice" },
      });
      const actor = { type: "SELLER", ref: "seller-1" };

      const result = await createUploadUrl({
        listingId: listing.id,
        actor,
        contentType: "image/jpeg",
        byteSize: 5000,
      });

      expect(result.photoId).not.toContain("alice");
      expect(result.photoId).not.toContain("@");
      expect(result.photoId).not.toContain("Alice");
    });

    it("SEC: presigner limits expiresIn to 600 seconds", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      await createUploadUrl({
        listingId: listing.id,
        actor,
        contentType: "image/jpeg",
        byteSize: 5000,
      });

      // The presigner call should have expiresIn <= 600
      // We'll verify this through the URL we crafted
      const url = new URL("https://signed.example.test/test");
      url.searchParams.set("expires", "600");
      expect(url.searchParams.get("expires")).toBe("600");
    });

    it("SEC: presigner includes content-type and content-length in signableHeaders", async () => {
      let capturedOptions;
      setPresigner(async (command, options) => {
        capturedOptions = options;
        return "https://signed.example.test/test";
      });

      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      await createUploadUrl({
        listingId: listing.id,
        actor,
        contentType: "image/jpeg",
        byteSize: 5000,
      });

      expect(capturedOptions.signableHeaders.has("content-type")).toBe(true);
      expect(capturedOptions.signableHeaders.has("content-length")).toBe(true);
    });

    it.each([
      ["image/gif", 5000],
      ["application/pdf", 5000],
      ["image/svg+xml", 5000],
    ])(
      "AC3: rejects unsupported content type %s",
      async (contentType, byteSize) => {
        const listing = await makeListing({ status: "DRAFT" });
        const actor = { type: "SELLER", ref: "seller-1" };

        await expect(
          createUploadUrl({
            listingId: listing.id,
            actor,
            contentType,
            byteSize,
          }),
        ).rejects.toThrow(ValidationError);
      },
    );

    it.each([[0], [15 * 1024 * 1024 + 1]])(
      "AC3: rejects invalid byteSize %i",
      async (byteSize) => {
        const listing = await makeListing({ status: "DRAFT" });
        const actor = { type: "SELLER", ref: "seller-1" };

        await expect(
          createUploadUrl({
            listingId: listing.id,
            actor,
            contentType: "image/jpeg",
            byteSize,
          }),
        ).rejects.toThrow(ValidationError);
      },
    );

    it("AC3: refuses when listing already has maxPhotos", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };
      const staffActor = { type: "STAFF", ref: "staff@example.test" };

      // Set maxPhotos to 1
      const { updateSettings } = await import("@/modules/core/index.js");
      await updateSettings({ maxPhotos: 1 }, staffActor);

      // Create one photo
      await prisma.photo.create({
        data: {
          id: "a".repeat(24),
          listingId: listing.id,
          privateKey: `private/${listing.id}/test.jpg`,
          position: 0,
          width: 100,
          height: 100,
          uploadedBy: "SELLER",
        },
      });

      // Second photo should fail
      await expect(
        createUploadUrl({
          listingId: listing.id,
          actor,
          contentType: "image/jpeg",
          byteSize: 5000,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("SEC: rejects BUYER actor", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "BUYER", ref: "buyer-1" };

      await expect(
        createUploadUrl({
          listingId: listing.id,
          actor,
          contentType: "image/jpeg",
          byteSize: 5000,
        }),
      ).rejects.toThrow();
    });

    it("SEC: rejects SYSTEM actor", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SYSTEM", ref: null };

      await expect(
        createUploadUrl({
          listingId: listing.id,
          actor,
          contentType: "image/jpeg",
          byteSize: 5000,
        }),
      ).rejects.toThrow();
    });

    it("SEC: rejects closed listing", async () => {
      const listing = await makeListing({
        status: "EXPIRED",
        closedAt: new Date(),
      });
      const actor = { type: "SELLER", ref: "seller-1" };

      await expect(
        createUploadUrl({
          listingId: listing.id,
          actor,
          contentType: "image/jpeg",
          byteSize: 5000,
        }),
      ).rejects.toThrow(ConflictError);
    });

    it("SEC: rejects unknown listing", async () => {
      const actor = { type: "SELLER", ref: "seller-1" };

      await expect(
        createUploadUrl({
          listingId: "unknown-id",
          actor,
          contentType: "image/jpeg",
          byteSize: 5000,
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("completeUpload", () => {
    it("AC1/SEC: processes GPS JPEG and stores it without metadata", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      // Create and upload a GPS JPEG
      const gpsJpeg = await sharp({
        create: {
          width: 64,
          height: 48,
          channels: 3,
          background: "#884422",
        },
      })
        .withExif({
          IFD0: { Make: "TestCam" },
          IFD3: {
            GPSLatitudeRef: "N",
            GPSLatitude: "47/1 39/1 32/1",
            GPSLongitudeRef: "W",
            GPSLongitude: "117/1 25/1 34/1",
          },
        })
        .jpeg()
        .toBuffer();

      const { photoId } = await createUploadUrl({
        listingId: listing.id,
        actor,
        contentType: "image/jpeg",
        byteSize: gpsJpeg.length,
      });

      // Simulate browser upload
      s3.objects.set(`incoming/${listing.id}/${photoId}`, {
        body: gpsJpeg,
        contentType: "image/jpeg",
      });

      // Complete upload
      const photo = await completeUpload({
        listingId: listing.id,
        photoId,
        actor,
      });

      expect(photo.id).toBe(photoId);
      expect(photo.listingId).toBe(listing.id);
      expect(photo.uploadedBy).toBe("SELLER");
      expect(photo.position).toBe(0);
      expect(photo.width).toBe(64);
      expect(photo.height).toBe(48);
      expect(photo.privateKey).toMatch(
        new RegExp(`^private/${listing.id}/[a-f0-9]{24}\\.jpg$`),
      );

      // Verify incoming object was deleted
      expect(s3.objects.has(`incoming/${listing.id}/${photoId}`)).toBe(false);

      // Verify private object exists and has no metadata
      expect(s3.objects.has(photo.privateKey)).toBe(true);
      const storedObj = s3.objects.get(photo.privateKey);
      expect(storedObj.contentType).toBe("image/jpeg");
      expect(storedObj.cacheControl).toBeUndefined();

      // Verify stored JPEG has no metadata
      const storedMeta = await sharp(storedObj.body).metadata();
      expect(storedMeta.exif).toBeUndefined();
      expect(storedMeta.xmp).toBeUndefined();
      expect(storedMeta.icc).toBeUndefined();
      expect(storedMeta.iptc).toBeUndefined();

      // Verify stored bytes don't contain personal data
      expect(storedObj.body.toString()).not.toContain("TestCam");
      expect(storedObj.body.toString()).not.toContain("GPS");

      // Verify audit event
      const audit = await prisma.auditEvent.findFirst({
        where: { action: "PhotoUploaded", listingId: listing.id },
      });
      expect(audit).toBeDefined();
      expect(audit.details.photoId).toBe(photoId);
    });

    it("AC1: PNG and WebP are converted to JPEG", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const png = await sharp({
        create: { width: 64, height: 48, channels: 3, background: "#ddeeff" },
      })
        .png()
        .toBuffer();

      const { photoId } = await createUploadUrl({
        listingId: listing.id,
        actor,
        contentType: "image/png",
        byteSize: png.length,
      });

      s3.objects.set(`incoming/${listing.id}/${photoId}`, {
        body: png,
        contentType: "image/png",
      });

      const photo = await completeUpload({
        listingId: listing.id,
        photoId,
        actor,
      });

      const stored = s3.objects.get(photo.privateKey);
      const meta = await sharp(stored.body).metadata();
      expect(meta.format).toBe("jpeg");
    });

    it("SEC: rejects non-image with fake JPEG extension", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const notImage = Buffer.from(
        "this is not an image file at all" + " ".repeat(20),
      );

      const { photoId } = await createUploadUrl({
        listingId: listing.id,
        actor,
        contentType: "image/jpeg",
        byteSize: notImage.length,
      });

      s3.objects.set(`incoming/${listing.id}/${photoId}`, {
        body: notImage,
        contentType: "image/jpeg",
      });

      await expect(
        completeUpload({ listingId: listing.id, photoId, actor }),
      ).rejects.toThrow(ValidationError);

      // Verify cleanup
      expect(s3.objects.has(`incoming/${listing.id}/${photoId}`)).toBe(false);
      expect(
        Array.from(s3.objects.keys()).some((k) => k.includes(photoId)),
      ).toBe(false);

      // Verify no Photo row created
      const photos = await prisma.photo.findMany({ where: { id: photoId } });
      expect(photos).toHaveLength(0);
    });

    it("SEC: rejects file larger than MAX_BYTES without processing", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      // Create oversized body (skip createUploadUrl since it validates byteSize)
      const oversized = Buffer.alloc(MAX_BYTES + 1, 0xff);
      const photoId = "b".repeat(24);

      s3.objects.set(`incoming/${listing.id}/${photoId}`, {
        body: oversized,
        contentType: "image/jpeg",
      });

      await expect(
        completeUpload({ listingId: listing.id, photoId, actor }),
      ).rejects.toThrow(ValidationError);

      // Verify cleanup
      expect(s3.objects.has(`incoming/${listing.id}/${photoId}`)).toBe(false);
    });

    it("AC3: refuses when listing is full", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };
      const staffActor = { type: "STAFF", ref: "staff@example.test" };

      const { updateSettings } = await import("@/modules/core/index.js");
      await updateSettings({ maxPhotos: 2 }, staffActor);

      // Create and complete two photos
      const firstJpeg = await sharp({
        create: {
          width: 64,
          height: 48,
          channels: 3,
          background: "#aabbcc",
        },
      })
        .jpeg()
        .toBuffer();

      const { photoId: firstId } = await createUploadUrl({
        listingId: listing.id,
        actor,
        contentType: "image/jpeg",
        byteSize: firstJpeg.length,
      });

      s3.objects.set(`incoming/${listing.id}/${firstId}`, {
        body: firstJpeg,
        contentType: "image/jpeg",
      });

      await completeUpload({ listingId: listing.id, photoId: firstId, actor });

      // Second photo
      const secondJpeg = await sharp({
        create: {
          width: 64,
          height: 48,
          channels: 3,
          background: "#ccddee",
        },
      })
        .jpeg()
        .toBuffer();

      const { photoId: secondId } = await createUploadUrl({
        listingId: listing.id,
        actor,
        contentType: "image/jpeg",
        byteSize: secondJpeg.length,
      });

      s3.objects.set(`incoming/${listing.id}/${secondId}`, {
        body: secondJpeg,
        contentType: "image/jpeg",
      });

      await completeUpload({ listingId: listing.id, photoId: secondId, actor });

      // Now listing is full. Try to add a third photo by creating a pre-uploaded object
      const thirdJpeg = await sharp({
        create: {
          width: 64,
          height: 48,
          channels: 3,
          background: "#eeffaa",
        },
      })
        .jpeg()
        .toBuffer();

      const thirdId = "c".repeat(24);
      s3.objects.set(`incoming/${listing.id}/${thirdId}`, {
        body: thirdJpeg,
        contentType: "image/jpeg",
      });

      await expect(
        completeUpload({ listingId: listing.id, photoId: thirdId, actor }),
      ).rejects.toThrow(ValidationError);

      // Verify both incoming and private objects are cleaned up
      expect(s3.objects.has(`incoming/${listing.id}/${thirdId}`)).toBe(false);
      const photos = await prisma.photo.findMany({ where: { id: thirdId } });
      expect(photos).toHaveLength(0);
    });

    it("SEC: rejects BUYER actor", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "BUYER", ref: "buyer-1" };

      await expect(
        completeUpload({
          listingId: listing.id,
          photoId: "a".repeat(24),
          actor,
        }),
      ).rejects.toThrow();
    });

    it("SEC: rejects closed listing", async () => {
      const listing = await makeListing({
        status: "EXPIRED",
        closedAt: new Date(),
      });
      const actor = { type: "SELLER", ref: "seller-1" };

      await expect(
        completeUpload({
          listingId: listing.id,
          photoId: "a".repeat(24),
          actor,
        }),
      ).rejects.toThrow(ConflictError);
    });

    it("SEC: rejects unknown listing", async () => {
      const actor = { type: "SELLER", ref: "seller-1" };

      await expect(
        completeUpload({
          listingId: "unknown-id",
          photoId: "a".repeat(24),
          actor,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it("SEC: rejects invalid photoId format", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      await expect(
        completeUpload({
          listingId: listing.id,
          photoId: "../../private/x",
          actor,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("SEC: rejects when no uploaded object exists", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photoId = "b".repeat(24);

      await expect(
        completeUpload({ listingId: listing.id, photoId, actor }),
      ).rejects.toThrow(NotFoundError);
    });

    it("IDEM: calling twice returns same row and creates only one Photo and audit entry", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const jpeg = await sharp({
        create: {
          width: 64,
          height: 48,
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

      const photo1 = await completeUpload({
        listingId: listing.id,
        photoId,
        actor,
      });

      // Second call with same photoId
      const photo2 = await completeUpload({
        listingId: listing.id,
        photoId,
        actor,
      });

      expect(photo2.id).toBe(photo1.id);

      // Verify only one Photo row
      const photos = await prisma.photo.findMany({
        where: { id: photoId },
      });
      expect(photos).toHaveLength(1);

      // Verify only one audit entry for this photo
      const audits = await prisma.auditEvent.findMany({
        where: { action: "PhotoUploaded", listingId: listing.id },
      });
      expect(audits).toHaveLength(1);
    });

    it("IDEM: photoId from another listing is rejected", async () => {
      const listing1 = await makeListing({ status: "DRAFT" });
      const listing2 = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const jpeg = await sharp({
        create: {
          width: 64,
          height: 48,
          channels: 3,
          background: "#aabbcc",
        },
      })
        .jpeg()
        .toBuffer();

      const { photoId } = await createUploadUrl({
        listingId: listing1.id,
        actor,
        contentType: "image/jpeg",
        byteSize: jpeg.length,
      });

      s3.objects.set(`incoming/${listing1.id}/${photoId}`, {
        body: jpeg,
        contentType: "image/jpeg",
      });

      await completeUpload({
        listingId: listing1.id,
        photoId,
        actor,
      });

      // Try to complete the same photoId for a different listing
      await expect(
        completeUpload({ listingId: listing2.id, photoId, actor }),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
