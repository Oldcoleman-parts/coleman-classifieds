import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing, mockS3, mockCloudFront } from "@/../tests/factories.js";
import {
  createUploadUrl,
  completeUpload,
  getPublicUrls,
  setS3Client,
  setCloudFrontClient,
  setPresigner,
} from "@/modules/media/index.js";
import {
  resetEventBus,
  publish as publishEvent,
  EVENTS,
} from "@/modules/core/index.js";
import { registerListeners } from "@/modules/media/events.js";
import sharp from "sharp";

describe("Photo approval (AC + SEC)", () => {
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
    resetEventBus();
    registerListeners();
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

  describe("Listing approval", () => {
    it("AC1: only approved photo is published after ListingWentLive", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo1 = await uploadPhoto(listing, actor);
      const photo2 = await uploadPhoto(listing, actor);

      // Approve only photo1
      await publishEvent(EVENTS.ListingApproved, {
        listingId: listing.id,
        photoIds: [photo1.id],
      });

      // Publish
      await publishEvent(EVENTS.ListingWentLive, {
        listingId: listing.id,
        firstTime: true,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      // Verify photo1 is published, photo2 is not
      const updated1 = await prisma.photo.findUnique({
        where: { id: photo1.id },
      });
      const updated2 = await prisma.photo.findUnique({
        where: { id: photo2.id },
      });

      expect(updated1.publicKeyBase).not.toBeNull();
      expect(updated2.publicKeyBase).toBeNull();

      // Verify only one URL is returned
      const urls = await getPublicUrls(listing.id);
      expect(urls).toHaveLength(1);

      // Verify only 3 public objects (one photo × 3 variants)
      const publicObjects = Array.from(s3.objects.keys()).filter((k) =>
        k.startsWith("public/"),
      );
      expect(publicObjects).toHaveLength(3);
    });
  });

  describe("Revision approval", () => {
    it("AC2: unapproved revision photo is published after RevisionApproved", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo1 = await uploadPhoto(listing, actor);
      const photo2 = await uploadPhoto(listing, actor);

      // Approve only photo1 first
      await publishEvent(EVENTS.ListingApproved, {
        listingId: listing.id,
        photoIds: [photo1.id],
      });

      // Publish the listing
      await publishEvent(EVENTS.ListingWentLive, {
        listingId: listing.id,
        firstTime: true,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      // Now approve revision with photo2
      await publishEvent(EVENTS.RevisionApproved, {
        listingId: listing.id,
        revisionId: "rev-1",
        photoIds: [photo2.id],
      });

      // Verify photo2 is now published
      const updated2 = await prisma.photo.findUnique({
        where: { id: photo2.id },
      });
      expect(updated2.publicKeyBase).not.toBeNull();

      // Verify two URLs are returned
      const urls = await getPublicUrls(listing.id);
      expect(urls).toHaveLength(2);
    });
  });

  describe("Security", () => {
    it("SEC: photoIds from another listing are not approved", async () => {
      const listing1 = await makeListing({ status: "DRAFT" });
      const listing2 = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo1 = await uploadPhoto(listing1, actor);
      const photo2 = await uploadPhoto(listing2, actor);

      // Try to approve photo1 (from listing1) on listing2
      await publishEvent(EVENTS.ListingApproved, {
        listingId: listing2.id,
        photoIds: [photo1.id],
      });

      // photo1 should still not be approved
      const updated1 = await prisma.photo.findUnique({
        where: { id: photo1.id },
      });
      expect(updated1.approvedAt).toBeNull();

      // photo2 should not be approved either (not in the photoIds list)
      const updated2 = await prisma.photo.findUnique({
        where: { id: photo2.id },
      });
      expect(updated2.approvedAt).toBeNull();
    });
  });

  describe("Idempotence", () => {
    it("IDEM: repeated ListingApproved is a no-op", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo = await uploadPhoto(listing, actor);

      // Approve the photo
      await publishEvent(EVENTS.ListingApproved, {
        listingId: listing.id,
        photoIds: [photo.id],
      });

      const firstApprovedAt = await prisma.photo.findUnique({
        where: { id: photo.id },
      });
      expect(firstApprovedAt.approvedAt).not.toBeNull();

      // Wait a moment to ensure timestamps would differ
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Approve again
      await publishEvent(EVENTS.ListingApproved, {
        listingId: listing.id,
        photoIds: [photo.id],
      });

      const secondApprovedAt = await prisma.photo.findUnique({
        where: { id: photo.id },
      });

      // approvedAt should not change
      expect(secondApprovedAt.approvedAt).toEqual(firstApprovedAt.approvedAt);
    });
  });
});
