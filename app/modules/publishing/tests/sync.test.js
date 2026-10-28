import { beforeEach, describe, expect, it } from "vitest";
import { addMonths, EVENTS, publish } from "@/modules/core/index.js";
import { PUBLIC_KEYS } from "@/modules/publishing/services/fields.js";
import { runScheduled } from "@/modules/publishing/index.js";
import {
  fieldsOf,
  lastLiveCount,
  lastUpsert,
  outbox,
  prisma,
  publishingAdmin,
  publishingProblems,
  publishingWorld,
  seedListing,
  upsertAnswer,
} from "./helpers.js";

const GID = "gid://shopify/Metaobject/lantern-abc123";

describe("Listing page sync (F06-T2)", () => {
  let shopify;
  const current = (id) => prisma.listing.findUnique({ where: { id } });

  beforeEach(async () => {
    await publishingWorld();
    shopify = publishingAdmin();
  });

  it("AC: an immediate update is written to the page", async () => {
    const listing = await seedListing({
      metaobjectGid: GID,
      metaobjectHandle: "lantern-abc123",
    });
    await prisma.listing.update({
      where: { id: listing.id },
      data: { title: "Renamed lantern" },
    });
    await publish(EVENTS.ListingUpdatedImmediate, {
      listingId: listing.id,
      fields: ["title"],
    });
    expect(fieldsOf(lastUpsert(shopify)).title).toBe("Renamed lantern");
  });

  it("AC: a revision is re-synced, and its email is sent once", async () => {
    const listing = await seedListing({
      metaobjectGid: GID,
      metaobjectHandle: "lantern-abc123",
    });
    const payload = {
      listingId: listing.id,
      revisionId: "rev-1",
      photoIds: [],
    };
    await publish(EVENTS.RevisionApproved, payload);
    await publish(EVENTS.RevisionApproved, payload);
    expect(shopify.of("ListingUpsert")).toHaveLength(2);
    expect(await outbox("revision_approved")).toEqual([
      { idempotencyKey: "revision_approved:rev-1", status: expect.any(String) },
    ]);
  });

  it("AC: pausing hides the page (DRAFT, photos kept) and drops live_count to 0", async () => {
    const listing = await seedListing({
      metaobjectGid: GID,
      metaobjectHandle: "lantern-abc123",
    });
    await prisma.listing.update({
      where: { id: listing.id },
      data: { status: "PAUSED", pausedAt: new Date(), pauseReason: "ORDINARY" },
    });
    await publish(EVENTS.ListingPaused, {
      listingId: listing.id,
      reason: "ORDINARY",
    });
    const upsert = lastUpsert(shopify);
    expect(upsert.metaobject.capabilities.publishable.status).toBe("DRAFT");
    expect(JSON.parse(fieldsOf(upsert).photos)).toHaveLength(1);
    expect(lastLiveCount(shopify)).toBe("0");
  });

  it("AC: resuming shows the page (ACTIVE) and live_count is 1 again", async () => {
    const listing = await seedListing({
      metaobjectGid: GID,
      metaobjectHandle: "lantern-abc123",
    });
    await publish(EVENTS.ListingResumed, {
      listingId: listing.id,
      reason: "ORDINARY",
      restoredMinutes: 0,
    });
    const upsert = lastUpsert(shopify);
    expect(upsert.metaobject.capabilities.publishable.status).toBe("ACTIVE");
    expect(fieldsOf(upsert).public_status).toBe("live");
    expect(lastLiveCount(shopify)).toBe("1");
  });

  it("AC: an extension updates expires_at", async () => {
    const listing = await seedListing({
      metaobjectGid: GID,
      metaobjectHandle: "lantern-abc123",
    });
    const expiresAt = addMonths((await current(listing.id)).expiresAt, 1);
    await prisma.listing.update({
      where: { id: listing.id },
      data: { expiresAt },
    });
    await publish(EVENTS.ListingExtended, {
      listingId: listing.id,
      minutes: 60 * 24 * 31,
      reason: "STAFF",
    });
    expect(fieldsOf(lastUpsert(shopify)).expires_at).toBe(
      expiresAt.toISOString(),
    );
  });

  it("AC: a sold listing shows only its title and 'closed', and live_count drops", async () => {
    const listing = await seedListing({
      status: "SOLD",
      metaobjectGid: GID,
      metaobjectHandle: "lantern-abc123",
      closedAt: new Date(),
      closedReason: "SOLD",
    });
    await publish(EVENTS.ListingClosed, {
      listingId: listing.id,
      reason: "SOLD",
    });
    const upsert = lastUpsert(shopify);
    expect(upsert.metaobject.capabilities.publishable.status).toBe("ACTIVE");
    const fields = fieldsOf(upsert);
    expect(fields.title).toBe("1962 Coleman 200A lantern");
    expect(fields.public_status).toBe("closed");
    expect(fields.listing_ref).toBe(listing.id);
    const emptied = PUBLIC_KEYS.filter(
      (key) => !["title", "public_status", "listing_ref"].includes(key),
    );
    for (const key of emptied) expect(["", "[]"]).toContain(fields[key]);
    expect(lastLiveCount(shopify)).toBe("0");
  });

  it("AC: a lapsed listing with no page makes no Shopify call", async () => {
    const listing = await seedListing({
      status: "LAPSED",
      photos: 0,
      liveAt: null,
      expiresAt: null,
    });
    await publish(EVENTS.ListingClosed, {
      listingId: listing.id,
      reason: "LAPSED",
    });
    expect(shopify.calls).toEqual([]);
  });

  it("AC: a failed page write is reported without throwing, and the hourly task repairs it", async () => {
    const listing = await seedListing({ photos: 0 });
    let attempts = 0;
    shopify = publishingAdmin({
      ListingUpsert: (variables) => {
        attempts += 1;
        return attempts === 1
          ? {
              metaobjectUpsert: {
                metaobject: null,
                userErrors: [{ code: "INVALID", message: "rejected" }],
              },
            }
          : upsertAnswer(variables);
      },
    });

    await expect(
      publish(EVENTS.ListingUpdatedImmediate, {
        listingId: listing.id,
        fields: ["title"],
      }),
    ).resolves.toBeUndefined();
    expect(await publishingProblems()).toEqual([
      {
        key: `ListingUpdatedImmediate:${listing.id}`,
        listingId: listing.id,
      },
    ]);
    expect((await current(listing.id)).metaobjectGid).toBeNull();

    const summary = await runScheduled();
    expect(summary).toMatchObject({ synced: 1, failed: 0 });
    expect((await current(listing.id)).metaobjectGid).toBe(
      `gid://shopify/Metaobject/${(await current(listing.id)).metaobjectHandle}`,
    );
  });
});
