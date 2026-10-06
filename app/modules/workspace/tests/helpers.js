// Shared setup for the workspace tests: signed app proxy requests through the real routes.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { Session } from "@shopify/shopify-api";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { prisma, resetDb } from "@/../tests/db.js";
import { makeListing, mockCloudFront, mockS3 } from "@/../tests/factories.js";
import { issueFormToken } from "@/modules/access/services/form-token.js";
import { resetRateLimits } from "@/modules/access/services/rate-limit.js";
import { updateSettings } from "@/modules/core/index.js";
import {
  setCloudFrontClient,
  setPresigner,
  setS3Client,
} from "@/modules/media/index.js";

export const SHOP = "ocp-dev.myshopify.com";
export const STAFF = { type: "STAFF", ref: "staff@example.test" };
export const DAY_MS = 24 * 60 * 60 * 1000;

/** A listing that has everything needed to be sent for review. */
export const COMPLETE = {
  title: "Coleman 200A lantern",
  description: "Red 1951 lantern, cleaned and working, new generator.",
  condition: "Working",
  city: "Wichita",
  state: "KS",
  askingPriceCents: 8500,
  sellerDisplay: "Sam",
  arrangements: ["PICKUP"],
};

// Shopify signs the query: parameters sorted by name, joined as key=value.
function signedUrl(path) {
  const params = {
    shop: SHOP,
    path_prefix: "/apps/classifieds",
    timestamp: String(Math.floor(Date.now() / 1000)),
    logged_in_customer_id: "",
  };
  const message = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("");
  const signature = createHmac("sha256", process.env.SHOPIFY_API_SECRET)
    .update(message)
    .digest("hex");
  return `https://app.example.test/proxy${path}?${new URLSearchParams({ ...params, signature })}`;
}

/** Reset the database, rate limits and media fakes, and install the shop's offline session. */
export async function setUp({ emailCodeRequired = false } = {}) {
  await resetDb();
  resetRateLimits();
  await new PrismaSessionStorage(prisma).storeSession(
    new Session({
      id: `offline_${SHOP}`,
      shop: SHOP,
      state: "test-state",
      isOnline: false,
      scope: process.env.SCOPES,
      accessToken: "test-access-token",
    }),
  );
  await updateSettings({ emailCodeRequired }, STAFF);
  const s3 = mockS3();
  setS3Client(s3);
  setCloudFrontClient(mockCloudFront());
  setPresigner(
    async (command) => `https://signed.example.test/${command.input.Key}`,
  );
  return { s3 };
}

export function tearDown() {
  setS3Client(null);
  setCloudFrontClient(null);
  setPresigner(null);
}

/**
 * A seller link with a listing in the given state, plus photos (approved or not).
 * @param {object} [listing] Listing columns (status set directly: fixture only)
 * @param {{ photos?: boolean[], invitation?: object }} [options] one entry per photo: approved?
 */
export async function sellerWith(
  listing = {},
  { photos = [], invitation = {} } = {},
) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256")
    .update(token + process.env.TOKEN_PEPPER)
    .digest("hex");
  const row = await makeListing({
    ...listing,
    invitation: { tokenHash, ...invitation },
  });
  const photoIds = [];
  for (const [position, approved] of photos.entries()) {
    const photo = await prisma.photo.create({
      data: {
        // Media's photo id format (24 hex characters).
        id: randomBytes(12).toString("hex"),
        listingId: row.id,
        privateKey: `private/${row.id}/${position}.jpg`,
        position,
        uploadedBy: "SELLER",
        approvedAt: approved ? new Date() : null,
      },
    });
    photoIds.push(photo.id);
  }
  return { token, invitation: row.invitation, listing: row, photoIds };
}

/**
 * Call a route's loader or action with a signed request.
 * @param {Function} handler a route `loader` or `action`
 * @param {{ token: string, invitation: { id: string } }} seller
 * @param {Record<string, string | string[]> | null} [fields] form fields (POST); null for GET
 * @param {{ csrf?: string | false, headers?: Record<string, string> }} [options] `csrf: false`
 *   sends no form token; by default a valid one is added
 */
export function call(
  handler,
  seller,
  fields = null,
  { csrf, headers = {} } = {},
) {
  let init = { headers };
  if (fields) {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields))
      for (const each of [value].flat()) form.append(name, each);
    const token =
      csrf === undefined ? issueFormToken(seller.invitation.id) : csrf;
    if (token) form.set("csrf", token);
    init = { method: "POST", body: form, headers };
  }
  return handler({
    request: new Request(signedUrl(`/seller/${seller.token}`), init),
    params: { token: seller.token },
  });
}

export const listingOf = (seller) =>
  prisma.listing.findUniqueOrThrow({ where: { id: seller.listing.id } });
