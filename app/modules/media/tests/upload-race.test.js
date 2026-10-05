import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { resetDb, prisma } from "@/../tests/db.js";
import { makeListing, mockS3, mockCloudFront } from "@/../tests/factories.js";
import {
  completeUpload,
  createUploadUrl,
  deletePhoto,
  setS3Client,
  setCloudFrontClient,
  setPresigner,
} from "@/modules/media/index.js";
import { updateSettings, ValidationError } from "@/modules/core/index.js";
import sharp from "sharp";

describe("Upload race condition (F03-FIX-1)", () => {
  let s3, cloudFront;
  let jpegFixture;

  beforeAll(async () => {
    await resetDb();
    jpegFixture = await sharp({
      create: { width: 64, height: 48, channels: 3, background: "#aabbcc" },
    })
      .jpeg()
      .toBuffer();
  });

  beforeEach(async () => {
    await resetDb();
    s3 = mockS3();
    setS3Client(s3);
    cloudFront = mockCloudFront();
    setCloudFrontClient(cloudFront);
    setPresigner(async (command) => {
      return `https://signed.example.test/${command.input.Key}`;
    });
  });

  afterEach(() => {
    setS3Client(null);
    setCloudFrontClient(null);
    setPresigner(null);
  });

  /**
   * Gate that makes two uploads race deterministically: wrap the fake's send so that
   * a PutObjectCommand whose Key starts with "private/" waits until N such puts have
   * arrived, then lets all of them through.
   */
  function gatePrivateWrites(s3Mock, expected) {
    const original = s3Mock.send.getMockImplementation();
    let waiting = [];
    s3Mock.send.mockImplementation(async (command) => {
      if (
        command.constructor.name === "PutObjectCommand" &&
        command.input.Key.startsWith("private/")
      ) {
        await new Promise((resolve) => {
          waiting.push(resolve);
          if (waiting.length >= expected) {
            const all = waiting;
            waiting = [];
            all.forEach((go) => go());
          }
        });
      }
      return original(command);
    });
  }

  it("AC1: two concurrent completes for same photoId on full listing both resolve", async () => {
    const listing = await makeListing({ status: "DRAFT" });
    const actor = { type: "SELLER", ref: "seller-1" };
    const staffActor = { type: "STAFF", ref: "staff@example.test" };

    await updateSettings({ maxPhotos: 1 }, staffActor);

    // Get upload URL and place file
    const { photoId } = await createUploadUrl({
      listingId: listing.id,
      actor,
      contentType: "image/jpeg",
      byteSize: jpegFixture.length,
    });

    s3.objects.set(`incoming/${listing.id}/${photoId}`, {
      body: jpegFixture,
      contentType: "image/jpeg",
    });

    gatePrivateWrites(s3, 2);

    // Race both completes
    const [photo1, photo2] = await Promise.all([
      completeUpload({ listingId: listing.id, photoId, actor }),
      completeUpload({ listingId: listing.id, photoId, actor }),
    ]);

    expect(photo1.id).toBe(photoId);
    expect(photo2.id).toBe(photoId);
    expect(photo1.id).toBe(photo2.id);

    const rows = await prisma.photo.findMany({ where: { id: photoId } });
    expect(rows).toHaveLength(1);

    const audits = await prisma.auditEvent.findMany({
      where: { action: "PhotoUploaded", listingId: listing.id },
    });
    expect(audits).toHaveLength(1);

    expect(s3.objects.has(rows[0].privateKey)).toBe(true);
    expect(s3.objects.has(`incoming/${listing.id}/${photoId}`)).toBe(false);
  });

  it("AC1b: two concurrent completes on listing with space both resolve", async () => {
    const listing = await makeListing({ status: "DRAFT" });
    const actor = { type: "SELLER", ref: "seller-1" };
    const staffActor = { type: "STAFF", ref: "staff@example.test" };

    await updateSettings({ maxPhotos: 5 }, staffActor);

    const { photoId } = await createUploadUrl({
      listingId: listing.id,
      actor,
      contentType: "image/jpeg",
      byteSize: jpegFixture.length,
    });

    s3.objects.set(`incoming/${listing.id}/${photoId}`, {
      body: jpegFixture,
      contentType: "image/jpeg",
    });

    gatePrivateWrites(s3, 2);

    const [photo1, photo2] = await Promise.all([
      completeUpload({ listingId: listing.id, photoId, actor }),
      completeUpload({ listingId: listing.id, photoId, actor }),
    ]);

    expect(photo1.id).toBe(photo2.id);

    const rows = await prisma.photo.findMany({ where: { id: photoId } });
    expect(rows).toHaveLength(1);

    const audits = await prisma.auditEvent.findMany({
      where: { action: "PhotoUploaded", listingId: listing.id },
    });
    expect(audits).toHaveLength(1);

    expect(s3.objects.has(rows[0].privateKey)).toBe(true);
    expect(s3.objects.has(`incoming/${listing.id}/${photoId}`)).toBe(false);
  });

  it("AC2: two different photoIds racing for last place, one wins and one is removed", async () => {
    const listing = await makeListing({ status: "DRAFT" });
    const actor = { type: "SELLER", ref: "seller-1" };
    const staffActor = { type: "STAFF", ref: "staff@example.test" };

    await updateSettings({ maxPhotos: 1 }, staffActor);

    // Get two upload URLs
    const { photoId: id1 } = await createUploadUrl({
      listingId: listing.id,
      actor,
      contentType: "image/jpeg",
      byteSize: jpegFixture.length,
    });

    const { photoId: id2 } = await createUploadUrl({
      listingId: listing.id,
      actor,
      contentType: "image/jpeg",
      byteSize: jpegFixture.length,
    });

    // Place both files
    s3.objects.set(`incoming/${listing.id}/${id1}`, {
      body: jpegFixture,
      contentType: "image/jpeg",
    });
    s3.objects.set(`incoming/${listing.id}/${id2}`, {
      body: jpegFixture,
      contentType: "image/jpeg",
    });

    gatePrivateWrites(s3, 2);

    // Race both completes
    const results = await Promise.allSettled([
      completeUpload({ listingId: listing.id, photoId: id1, actor }),
      completeUpload({ listingId: listing.id, photoId: id2, actor }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ValidationError);

    // One Photo row: the winner's
    const photos = await prisma.photo.findMany({
      where: { listingId: listing.id },
    });
    expect(photos).toHaveLength(1);

    // Winner's private object exists
    expect(s3.objects.has(photos[0].privateKey)).toBe(true);

    // No object contains the loser's id
    const allKeys = Array.from(s3.objects.keys());
    const winnerId = photos[0].id;
    const loserId = winnerId === id1 ? id2 : id1;
    expect(allKeys.some((k) => k.includes(loserId))).toBe(false);
  });

  it("AC3: full listing refuses second upload without reading incoming", async () => {
    const listing = await makeListing({ status: "DRAFT" });
    const actor = { type: "SELLER", ref: "seller-1" };
    const staffActor = { type: "STAFF", ref: "staff@example.test" };

    await updateSettings({ maxPhotos: 1 }, staffActor);

    // Complete first photo
    const { photoId: firstId } = await createUploadUrl({
      listingId: listing.id,
      actor,
      contentType: "image/jpeg",
      byteSize: jpegFixture.length,
    });

    s3.objects.set(`incoming/${listing.id}/${firstId}`, {
      body: jpegFixture,
      contentType: "image/jpeg",
    });

    await completeUpload({ listingId: listing.id, photoId: firstId, actor });

    // Listing is now full. Place second photo in incoming.
    const secondId = "b".repeat(24);
    s3.objects.set(`incoming/${listing.id}/${secondId}`, {
      body: jpegFixture,
      contentType: "image/jpeg",
    });

    // `sent` is the fake's own array, so later commands are found by position.
    const sentBefore = s3.sent.length;

    await expect(
      completeUpload({ listingId: listing.id, photoId: secondId, actor }),
    ).rejects.toThrow(ValidationError);

    // Check that no GetObjectCommand was issued during the call
    const later = s3.sent.slice(sentBefore).map((cmd) => cmd.constructor.name);
    expect(later).not.toContain("GetObjectCommand");
    expect(later).not.toContain("PutObjectCommand");

    // Incoming object is removed
    expect(s3.objects.has(`incoming/${listing.id}/${secondId}`)).toBe(false);

    // Second photoId is not in the database
    const photos = await prisma.photo.findMany({ where: { id: secondId } });
    expect(photos).toHaveLength(0);

    // The photo that was already completed is still returned on the full listing.
    const again = await completeUpload({
      listingId: listing.id,
      photoId: firstId,
      actor,
    });
    expect(again.id).toBe(firstId);
  });

  it("AC3b: after refused completion, earlier photo's private object still exists", async () => {
    const listing = await makeListing({ status: "DRAFT" });
    const actor = { type: "SELLER", ref: "seller-1" };
    const staffActor = { type: "STAFF", ref: "staff@example.test" };

    await updateSettings({ maxPhotos: 1 }, staffActor);

    // Complete first photo
    const { photoId: firstId } = await createUploadUrl({
      listingId: listing.id,
      actor,
      contentType: "image/jpeg",
      byteSize: jpegFixture.length,
    });

    s3.objects.set(`incoming/${listing.id}/${firstId}`, {
      body: jpegFixture,
      contentType: "image/jpeg",
    });

    const firstPhoto = await completeUpload({
      listingId: listing.id,
      photoId: firstId,
      actor,
    });

    // Try to add second photo (will be refused)
    const secondId = "b".repeat(24);
    s3.objects.set(`incoming/${listing.id}/${secondId}`, {
      body: jpegFixture,
      contentType: "image/jpeg",
    });

    await expect(
      completeUpload({ listingId: listing.id, photoId: secondId, actor }),
    ).rejects.toThrow(ValidationError);

    // First photo's private object still exists
    expect(s3.objects.has(firstPhoto.privateKey)).toBe(true);
  });

  it("AC4: deleteObjects errors are failures and files are kept", async () => {
    const listing = await makeListing({ status: "DRAFT" });
    const actor = { type: "SELLER", ref: "seller-1" };

    const { photoId } = await createUploadUrl({
      listingId: listing.id,
      actor,
      contentType: "image/jpeg",
      byteSize: jpegFixture.length,
    });

    s3.objects.set(`incoming/${listing.id}/${photoId}`, {
      body: jpegFixture,
      contentType: "image/jpeg",
    });

    const photo = await completeUpload({
      listingId: listing.id,
      photoId,
      actor,
    });

    // Make the delete fail
    s3.failDeletes.add(photo.privateKey);

    await expect(deletePhoto(listing.id, photo.id, actor)).rejects.toThrow();

    // Row's deletedAt is still null
    const row = await prisma.photo.findUnique({ where: { id: photo.id } });
    expect(row.deletedAt).toBeNull();

    // Object is still in the bucket
    expect(s3.objects.has(photo.privateKey)).toBe(true);

    // After clearing failDeletes, second deletePhoto succeeds
    s3.failDeletes.clear();
    await deletePhoto(listing.id, photo.id, actor);

    const deletedRow = await prisma.photo.findUnique({
      where: { id: photo.id },
    });
    expect(deletedRow.deletedAt).not.toBeNull();
  });

  it("SEC: cleanup failure does not hide the upload result", async () => {
    const listing = await makeListing({ status: "DRAFT" });
    const actor = { type: "SELLER", ref: "seller-1" };

    const { photoId } = await createUploadUrl({
      listingId: listing.id,
      actor,
      contentType: "image/jpeg",
      byteSize: jpegFixture.length,
    });

    s3.objects.set(`incoming/${listing.id}/${photoId}`, {
      body: jpegFixture,
      contentType: "image/jpeg",
    });

    // Make incoming delete fail
    s3.failDeletes.add(`incoming/${listing.id}/${photoId}`);

    // Silence console.error during this test
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const photo = await completeUpload({
      listingId: listing.id,
      photoId,
      actor,
    });

    spy.mockRestore();

    // Photo still resolves successfully
    expect(photo.id).toBe(photoId);
    expect(photo.privateKey).toBeDefined();

    // Photo row is created
    const row = await prisma.photo.findUnique({ where: { id: photoId } });
    expect(row).not.toBeNull();

    // Audit event is created
    const audits = await prisma.auditEvent.findMany({
      where: { action: "PhotoUploaded", listingId: listing.id },
    });
    expect(audits).toHaveLength(1);
  });
});
