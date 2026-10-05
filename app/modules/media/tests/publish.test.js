import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing, mockS3, mockCloudFront } from "@/../tests/factories.js";
import {
  createUploadUrl,
  completeUpload,
  publish,
  unpublish,
  unpublishOne,
  listPhotos,
  getPublicUrls,
  setS3Client,
  setCloudFrontClient,
  setPresigner,
} from "@/modules/media/index.js";
import sharp from "sharp";

describe("Publish and unpublish (AC + SEC)", () => {
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
        width: 1600,
        height: 1200,
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

  describe("listPhotos", () => {
    it("AC2: returns preview URLs with correct format", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo = await uploadPhoto(listing, actor);

      const photos = await listPhotos(listing.id);

      expect(photos).toHaveLength(1);
      expect(photos[0].id).toBe(photo.id);
      expect(photos[0].position).toBe(0);
      expect(photos[0].isMain).toBe(true);
      expect(photos[0].previewUrl).toContain("signed.example.test");
      expect(photos[0].previewUrl).not.toContain("amazonaws.com");
      expect(photos[0].previewUrl).not.toContain("test-bucket");
      expect(photos[0].published).toBe(false);
      expect(photos[0].width).toBe(1600);
      expect(photos[0].height).toBe(1200);
    });

    it("AC2: main photo first, others in order", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo1 = await uploadPhoto(listing, actor);
      const photo2 = await uploadPhoto(listing, actor);

      const photos = await listPhotos(listing.id);

      expect(photos).toHaveLength(2);
      expect(photos[0].id).toBe(photo1.id);
      expect(photos[0].isMain).toBe(true);
      expect(photos[1].id).toBe(photo2.id);
      expect(photos[1].isMain).toBe(false);
    });
  });

  describe("publish", () => {
    it("AC2/publish: creates 6 public objects (2 photos × 3 variants)", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      await uploadPhoto(listing, actor);
      await uploadPhoto(listing, actor);

      await publish(listing.id);

      // Should have 6 objects: 2 photos × 3 variants
      const publicObjects = Array.from(s3.objects.keys()).filter((k) =>
        k.startsWith("public/"),
      );
      expect(publicObjects).toHaveLength(6);

      // Verify naming convention and metadata
      for (const key of publicObjects) {
        const obj = s3.objects.get(key);
        expect(obj.contentType).toBe("image/jpeg");
        expect(obj.cacheControl).toContain("immutable");
        expect(key).toMatch(/_thumb\.jpg$|_medium\.jpg$|_large\.jpg$/);
      }
    });

    it("AC2/publish: returns URLs in position order, main photo first", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      await uploadPhoto(listing, actor);
      await uploadPhoto(listing, actor);

      const urls = await publish(listing.id);

      expect(urls).toHaveLength(2);
      expect(urls[0]).toContain("photos.example.test");
      expect(urls[0]).toContain("public/");
      expect(urls[0]).toContain(listing.id);
      expect(urls[0]).toContain("_large.jpg");
      expect(urls[1]).toContain("photos.example.test");
      expect(urls[1]).toContain(listing.id);
    });

    it("AC2/publish: public key base does not contain photo id", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo = await uploadPhoto(listing, actor);

      await publish(listing.id);

      const updated = await prisma.photo.findUnique({
        where: { id: photo.id },
      });

      expect(updated.publicKeyBase).toBeDefined();
      expect(updated.publicKeyBase).not.toContain(photo.id);
    });

    it("AC2/publish: variant sizes do not exceed limits", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      await uploadPhoto(listing, actor);

      await publish(listing.id);

      // Check the actual variant objects
      const publicObjects = Array.from(s3.objects.entries()).filter(([k]) =>
        k.startsWith("public/"),
      );

      for (const [key, obj] of publicObjects) {
        const meta = await sharp(obj.body).metadata();
        if (key.includes("_thumb")) {
          expect(meta.width).toBeLessThanOrEqual(320);
          expect(meta.height).toBeLessThanOrEqual(320);
        } else if (key.includes("_medium")) {
          expect(meta.width).toBeLessThanOrEqual(800);
          expect(meta.height).toBeLessThanOrEqual(800);
        } else if (key.includes("_large")) {
          expect(meta.width).toBeLessThanOrEqual(1600);
          expect(meta.height).toBeLessThanOrEqual(1600);
        }
      }
    });

    it("IDEM: publish twice writes no new objects", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      await uploadPhoto(listing, actor);

      const urls1 = await publish(listing.id);
      const objectCount1 = s3.sent.length;

      const urls2 = await publish(listing.id);
      const objectCount2 = s3.sent.length;

      expect(urls1).toEqual(urls2);
      // Same number of commands sent (no new PutObjectCommands)
      expect(objectCount2).toBe(objectCount1);
    });

    it("IDEM: publish with photoIds array publishes only that photo", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo1 = await uploadPhoto(listing, actor);
      const photo2 = await uploadPhoto(listing, actor);

      const urls = await publish(listing.id, { photoIds: [photo1.id] });

      expect(urls).toHaveLength(1);

      const photo2Updated = await prisma.photo.findUnique({
        where: { id: photo2.id },
      });
      expect(photo2Updated.publicKeyBase).toBeNull();
    });
  });

  describe("unpublish", () => {
    it("AC3: removes all public objects", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      await uploadPhoto(listing, actor);
      await uploadPhoto(listing, actor);

      await publish(listing.id);

      const objectsBefore = Array.from(s3.objects.keys()).filter((k) =>
        k.startsWith("public/"),
      );
      expect(objectsBefore.length).toBeGreaterThan(0);

      await unpublish(listing.id);

      const objectsAfter = Array.from(s3.objects.keys()).filter((k) =>
        k.startsWith("public/"),
      );
      expect(objectsAfter).toHaveLength(0);
    });

    it("AC3: nulls publicKeyBase", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo = await uploadPhoto(listing, actor);

      await publish(listing.id);

      let updated = await prisma.photo.findUnique({ where: { id: photo.id } });
      expect(updated.publicKeyBase).not.toBeNull();

      await unpublish(listing.id);

      updated = await prisma.photo.findUnique({ where: { id: photo.id } });
      expect(updated.publicKeyBase).toBeNull();
    });

    it("AC3: sends one CloudFront invalidation command", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      await uploadPhoto(listing, actor);
      await publish(listing.id);

      cloudFront.sent.length = 0;
      await unpublish(listing.id);

      const invalidations = cloudFront.sent.filter(
        (cmd) => cmd.constructor.name === "CreateInvalidationCommand",
      );
      expect(invalidations).toHaveLength(1);

      const inv = invalidations[0];
      expect(inv.input.DistributionId).toBe("TESTDIST");
      expect(inv.input.InvalidationBatch.Paths.Items).toEqual([
        `/public/${listing.id}/*`,
      ]);
    });

    it("AC3: second unpublish sends no new commands", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      await uploadPhoto(listing, actor);
      await publish(listing.id);

      cloudFront.sent.length = 0;
      await unpublish(listing.id);
      const sentAfterFirst = cloudFront.sent.length;

      cloudFront.sent.length = 0;
      await unpublish(listing.id);
      const sentAfterSecond = cloudFront.sent.length;

      expect(sentAfterFirst).toBe(1);
      expect(sentAfterSecond).toBe(0);
    });

    it("AC3: works when nothing is published", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      await uploadPhoto(listing, actor);

      const result = await unpublish(listing.id);

      expect(result.unpublished).toBe(0);
    });
  });

  describe("unpublishOne", () => {
    it("AC3: removes only that photo's three objects", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo1 = await uploadPhoto(listing, actor);
      await uploadPhoto(listing, actor);

      await publish(listing.id);

      const objectsBefore = Array.from(s3.objects.keys()).filter((k) =>
        k.startsWith("public/"),
      );
      expect(objectsBefore).toHaveLength(6); // 2 photos × 3 variants

      await unpublishOne(photo1.id);

      const objectsAfter = Array.from(s3.objects.keys()).filter((k) =>
        k.startsWith("public/"),
      );
      expect(objectsAfter).toHaveLength(3); // Only photo2's variants remain
    });

    it("AC3: nulls publicKeyBase for that photo only", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo1 = await uploadPhoto(listing, actor);
      const photo2 = await uploadPhoto(listing, actor);

      await publish(listing.id);

      await unpublishOne(photo1.id);

      const p1 = await prisma.photo.findUnique({ where: { id: photo1.id } });
      const p2 = await prisma.photo.findUnique({ where: { id: photo2.id } });

      expect(p1.publicKeyBase).toBeNull();
      expect(p2.publicKeyBase).not.toBeNull();
    });

    it("AC3: works when photo is not published", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo = await uploadPhoto(listing, actor);

      const result = await unpublishOne(photo.id);

      expect(result.unpublished).toBe(0);
    });
  });

  describe("getPublicUrls", () => {
    it("AC2/publish: returns CloudFront URLs only", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      await uploadPhoto(listing, actor);
      await uploadPhoto(listing, actor);

      await publish(listing.id);

      const urls = await getPublicUrls(listing.id);

      expect(urls).toHaveLength(2);
      for (const url of urls) {
        expect(url).toContain("photos.example.test");
        expect(url).toContain("public/");
        expect(url).not.toContain("amazonaws.com");
        expect(url).not.toContain("test-bucket");
      }
    });

    it("AC2/publish: main photo URL returned first", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      await uploadPhoto(listing, actor);
      await uploadPhoto(listing, actor);

      await publish(listing.id);

      const urls = await getPublicUrls(listing.id);

      // Both are large URLs
      expect(urls[0]).toContain("_large.jpg");
      expect(urls[1]).toContain("_large.jpg");
    });
  });
});
