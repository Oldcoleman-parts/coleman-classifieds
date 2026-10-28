// Shared set-up for the publishing tests (F06-T2). The database, the SES stand-in and the paid
// flow come from the payments helpers; media's storage seams are stubbed here.
import { randomBytes } from "node:crypto";
import { addMonths } from "@/modules/core/index.js";
import { makeListing, mockCloudFront, mockS3 } from "@/../tests/factories.js";
import {
  fakeAdmin,
  freshWorld,
  prisma,
} from "@/modules/payments/tests/helpers.js";
import {
  register as registerMedia,
  setCloudFrontClient,
  setS3Client,
} from "@/modules/media/index.js";
import { register as registerScheduler } from "@/modules/scheduler/index.js";
import {
  register as registerPublishing,
  resetDefinitionCache,
  resetPublishingProblems,
  setOfflineAdmin,
} from "@/modules/publishing/index.js";
import { PUBLIC_KEYS } from "@/modules/publishing/services/fields.js";

export const SELLER = { name: "Sam Seller", email: "sam.seller@example.test" };
export const SHOP_GID = "gid://shopify/Shop/1";
const DEFINITION_GID = "gid://shopify/MetaobjectDefinition/1";
export const PHOTO_HOST = "https://photos.example.test/";

/** The answers every publishing operation needs; a test replaces the ones it cares about. */
export const ANSWERS = {
  ListingDefinition: {
    metaobjectDefinitionByType: {
      id: DEFINITION_GID,
      fieldDefinitions: PUBLIC_KEYS.map((key) => ({ key })),
    },
  },
  ListingDefinitionCreate: {
    metaobjectDefinitionCreate: {
      metaobjectDefinition: { id: DEFINITION_GID },
      userErrors: [],
    },
  },
  ListingDefinitionUpdate: {
    metaobjectDefinitionUpdate: {
      metaobjectDefinition: { id: DEFINITION_GID },
      userErrors: [],
    },
  },
  LiveCountDefinitionCreate: {
    metafieldDefinitionCreate: {
      createdDefinition: { id: "gid://shopify/MetafieldDefinition/1" },
      userErrors: [],
    },
  },
  ShopLiveCount: {
    shop: { id: SHOP_GID, currencyCode: "USD", metafield: null },
  },
  LiveCountSet: {
    metafieldsSet: {
      metafields: [{ id: "gid://shopify/Metafield/1" }],
      userErrors: [],
    },
  },
  ListingUpsert: upsertAnswer,
  ListingEntries: {
    metaobjects: {
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  },
  RedirectByPath: { urlRedirects: { nodes: [] } },
  RedirectCreate: {
    urlRedirectCreate: {
      urlRedirect: { id: "gid://shopify/UrlRedirect/1" },
      userErrors: [],
    },
  },
  ListingDelete: {
    metaobjectDelete: {
      deletedId: "gid://shopify/Metaobject/1",
      userErrors: [],
    },
  },
};

/** The default ListingUpsert answer: the entry's gid follows its handle. */
export function upsertAnswer(variables) {
  const handle = variables.handle.handle;
  return {
    metaobjectUpsert: {
      metaobject: { id: `gid://shopify/Metaobject/${handle}`, handle },
      userErrors: [],
    },
  };
}

/**
 * An empty database, core, media and publishing listening, the storage seams stubbed and
 * fresh caches. The fee setup is not seeded: call `seedFeeSetup()` for the paid flow.
 */
export async function publishingWorld() {
  const world = await freshWorld();
  // Clears the task registry, so the two `register()` calls below can't add a task twice.
  registerScheduler();
  registerMedia();
  registerPublishing();
  const s3 = mockS3();
  const cloudFront = mockCloudFront();
  setS3Client(s3);
  setCloudFrontClient(cloudFront);
  resetDefinitionCache();
  resetPublishingProblems();
  return { ...world, s3, cloudFront };
}

/**
 * The Admin client for the publishing code. Answers by operation name; `overrides` replace
 * the defaults. Also used as the offline client, so event handlers and tasks reach it.
 * @param {Record<string, object | ((variables: object) => object)>} [overrides]
 */
export function publishingAdmin(overrides = {}) {
  const shopify = fakeAdmin({ ...ANSWERS, ...overrides });
  setOfflineAdmin(shopify.admin);
  return shopify;
}

const LIVE_STATES = ["LIVE", "PAUSED", "SOLD", "EXPIRED", "REMOVED"];

/**
 * A listing with the seller's details and `photos` approved, published photos. Its live
 * dates follow its status (a month from `liveAt`) unless given.
 * @param {{ status?: string, photos?: number } & Record<string, unknown>} [options]
 */
export async function seedListing({
  status = "LIVE",
  photos = 1,
  ...overrides
} = {}) {
  const liveAt = LIVE_STATES.includes(status)
    ? new Date(Date.now() - 60_000)
    : null;
  const listing = await makeListing({
    status,
    title: "1962 Coleman 200A lantern",
    description: "Original mantle, works well.",
    condition: "Good",
    askingPriceCents: 2500,
    quantityAvailable: 1,
    city: "Wichita",
    state: "KS",
    arrangements: ["PICKUP"],
    sellerDisplay: SELLER.name,
    liveAt,
    expiresAt: liveAt ? addMonths(liveAt, 1) : null,
    invitation: {
      sellerName: SELLER.name,
      sellerEmail: SELLER.email,
      feeRegularCents: 3000,
      feeOfferedCents: 2500,
    },
    ...overrides,
  });
  for (let position = 0; position < photos; position++)
    await addPhoto(listing.id, position);
  return listing;
}

/**
 * A photo row. Approved and published by default, so `publish()` has nothing left to copy
 * and no bucket is needed.
 */
export function addPhoto(
  listingId,
  position,
  { approved = true, published = true } = {},
) {
  return prisma.photo.create({
    data: {
      listingId,
      privateKey: `private/${listingId}/${position}.jpg`,
      publicKeyBase: published
        ? `public/${listingId}/${randomBytes(16).toString("hex")}`
        : null,
      position,
      uploadedBy: "SELLER",
      approvedAt: approved ? new Date() : null,
    },
  });
}

/** The fields of an `ListingUpsert` call, as a key → value map. */
export function fieldsOf(variables) {
  return Object.fromEntries(
    variables.metaobject.fields.map(({ key, value }) => [key, value]),
  );
}

/** Every `ListingUpsert` call's variables, oldest first. */
export const upserts = (shopify) => shopify.of("ListingUpsert");
/** The last `ListingUpsert` call's variables. */
export const lastUpsert = (shopify) => upserts(shopify).at(-1);
/** The value last written to `live_count`, or undefined when never written. */
export const lastLiveCount = (shopify) =>
  shopify.of("LiveCountSet").at(-1)?.metafields[0].value;

/** The `listing_live` or `revision_approved` rows in the email outbox. */
export const outbox = (templateKey) =>
  prisma.emailOutbox.findMany({
    where: { templateKey },
    select: { idempotencyKey: true, status: true },
  });

/** The `PublishingProblem` audit rows (key and listing id), oldest first. */
export async function publishingProblems() {
  const rows = await prisma.auditEvent.findMany({
    where: { action: "PublishingProblem" },
    orderBy: { id: "asc" },
  });
  return rows.map((row) => ({
    key: row.details.key,
    listingId: row.listingId,
  }));
}

export { prisma, PHOTO_HOST as CLOUDFRONT_PREFIX };
