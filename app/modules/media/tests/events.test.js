import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing, mockS3, mockCloudFront } from "@/../tests/factories.js";
import {
  createUploadUrl,
  completeUpload,
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

describe("Event integration (Events + IDEM)", () => {
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

  describe("ListingWentLive event", () => {
    it("Events: publishes photos automatically", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo = await uploadPhoto(listing, actor);

      // Verify not published yet
      let updated = await prisma.photo.findUnique({ where: { id: photo.id } });
      expect(updated.publicKeyBase).toBeNull();

      // Publish the event
      await publishEvent(EVENTS.ListingWentLive, {
        listingId: listing.id,
        firstTime: true,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      // Verify photo is now published
      updated = await prisma.photo.findUnique({ where: { id: photo.id } });
      expect(updated.publicKeyBase).not.toBeNull();

      // Verify public objects exist
      const publicObjects = Array.from(s3.objects.keys()).filter((k) =>
        k.startsWith("public/"),
      );
      expect(publicObjects.length).toBeGreaterThan(0);
    });

    it("Events: handles multiple photos", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      await uploadPhoto(listing, actor);
      await uploadPhoto(listing, actor);

      await publishEvent(EVENTS.ListingWentLive, {
        listingId: listing.id,
        firstTime: true,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const photos = await prisma.photo.findMany({
        where: { listingId: listing.id },
      });

      expect(photos).toHaveLength(2);
      expect(photos.every((p) => p.publicKeyBase !== null)).toBe(true);
    });
  });

  describe("RevisionApproved event", () => {
    it("Events: publishes photos", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo = await uploadPhoto(listing, actor);

      // Publish via RevisionApproved event
      await publishEvent(EVENTS.RevisionApproved, {
        listingId: listing.id,
        revisionId: "rev-123",
      });

      const updated = await prisma.photo.findUnique({
        where: { id: photo.id },
      });
      expect(updated.publicKeyBase).not.toBeNull();
    });
  });

  describe("ListingClosed event", () => {
    it("Events: unpublishes photos", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      const photo = await uploadPhoto(listing, actor);

      // Publish first
      await publishEvent(EVENTS.ListingWentLive, {
        listingId: listing.id,
        firstTime: true,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      let updated = await prisma.photo.findUnique({ where: { id: photo.id } });
      expect(updated.publicKeyBase).not.toBeNull();

      expect(
        Array.from(s3.objects.keys()).filter((k) => k.startsWith("public/")),
      ).toHaveLength(3);

      // Close the listing
      await publishEvent(EVENTS.ListingClosed, {
        listingId: listing.id,
        reason: "EXPIRED",
      });

      updated = await prisma.photo.findUnique({ where: { id: photo.id } });
      expect(updated.publicKeyBase).toBeNull();

      const publicObjectsAfter = Array.from(s3.objects.keys()).filter((k) =>
        k.startsWith("public/"),
      );
      expect(publicObjectsAfter).toHaveLength(0);
    });

    it("IDEM: unpublish event twice removes objects only once", async () => {
      const listing = await makeListing({ status: "DRAFT" });
      const actor = { type: "SELLER", ref: "seller-1" };

      await uploadPhoto(listing, actor);

      // Publish
      await publishEvent(EVENTS.ListingWentLive, {
        listingId: listing.id,
        firstTime: true,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      expect(
        Array.from(s3.objects.keys()).filter((k) => k.startsWith("public/")),
      ).toHaveLength(3);

      s3.sent.length = 0;
      await publishEvent(EVENTS.ListingClosed, {
        listingId: listing.id,
        reason: "EXPIRED",
      });
      const commandsAfterFirst = s3.sent.length;

      s3.sent.length = 0;
      await publishEvent(EVENTS.ListingClosed, {
        listingId: listing.id,
        reason: "EXPIRED",
      });
      const commandsAfterSecond = s3.sent.length;

      // The first close deletes the public copies; the second finds nothing to do.
      expect(commandsAfterFirst).toBeGreaterThan(0);
      expect(commandsAfterSecond).toBe(0);
    });
  });
});
