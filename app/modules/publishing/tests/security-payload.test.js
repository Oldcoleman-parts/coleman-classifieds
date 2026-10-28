import { beforeEach, describe, expect, it } from "vitest";
import { syncListing } from "@/modules/publishing/index.js";
import { cloudFrontOnly, sellerName } from "@/modules/publishing/services/fields.js";
import {
  fieldsOf,
  lastUpsert,
  publishingAdmin,
  publishingWorld,
  SELLER,
  seedListing,
} from "./helpers.js";

// The only keys a listing page may carry. Adding one means reviewing it for PII first.
const EXPECTED_KEYS = [
  "title", "condition", "description", "known_issues", "contents", "asking_price",
  "quantity_available", "availability_note", "city", "state", "arrangements",
  "arrangements_note", "photos", "seller_display", "public_status", "live_at",
  "expires_at", "listing_ref",
];

const PHONE = /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}/;

describe("Metaobject payload privacy (F06-T2)", () => {
  let shopify;

  beforeEach(async () => {
    await publishingWorld();
    shopify = publishingAdmin();
  });

  it("SEC: the metaobject payload carries exactly the whitelisted field keys", async () => {
    const listing = await seedListing();
    await syncListing(listing.id);
    const keys = lastUpsert(shopify).metaobject.fields.map((field) => field.key);
    expect(keys).toEqual(EXPECTED_KEYS);
  });

  it("SEC: no payload value holds the seller's email, a phone number, the last name or an address", async () => {
    const listing = await seedListing();
    await syncListing(listing.id);
    const values = lastUpsert(shopify).metaobject.fields.map((field) => field.value);
    const text = values.join("\n");
    expect(text).not.toContain(SELLER.email);
    expect(text).not.toContain("@");
    expect(text).not.toMatch(PHONE);
    expect(text).not.toContain("Seller");
    expect(fieldsOf(lastUpsert(shopify)).seller_display).toBe("Sam");
  });

  it.each([
    ["Sam Seller", "Sam"],
    ["Samantha Jo Seller", "Samantha"],
    ["Private seller", "Private seller"],
    [null, "Private seller"],
    ["   ", "Private seller"],
  ])("SEC: the seller name %j shows as %j", (input, shown) => {
    expect(sellerName(input)).toBe(shown);
  });

  it.each([
    "http://photos.example.test/public/a/x_large.jpg",
    "https://photos.example.test.evil.test/public/a/x_large.jpg",
    "https://evil.example.test/public/a/x_large.jpg",
    'https://photos.example.test/public/a/x"onmouseover=1_large.jpg',
    "https://photos.example.test/public/a/x<b>_large.jpg",
    "https://photos.example.test/public/a/x y_large.jpg",
    "javascript:alert(1)",
  ])("SEC: the photo address %s is dropped", (url) => {
    expect(cloudFrontOnly([url])).toEqual([]);
  });

  it("SEC: a CloudFront https photo address is kept", () => {
    const url = "https://photos.example.test/public/a/x_large.jpg";
    expect(cloudFrontOnly([url])).toEqual([url]);
  });
});
