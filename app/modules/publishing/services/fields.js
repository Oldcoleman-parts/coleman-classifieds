// What a listing page is allowed to show. This file is the whitelist: nothing reaches the
// metaobject except the keys below, and none of them can hold the seller's email, phone,
// last name or street address.

/**
 * @typedef {import("./facts.js").Publishable} Publishable
 * @typedef {{ key: string, value: string }} Field
 */

/** Every key the `classified_listing` definition has, with its Shopify type. */
export const FIELD_DEFINITIONS = [
  { key: "title", name: "Title", type: "single_line_text_field" },
  { key: "condition", name: "Condition", type: "single_line_text_field" },
  { key: "description", name: "Description", type: "multi_line_text_field" },
  { key: "known_issues", name: "Known issues", type: "multi_line_text_field" },
  { key: "contents", name: "Contents", type: "multi_line_text_field" },
  { key: "asking_price", name: "Asking price", type: "money" },
  {
    key: "quantity_available",
    name: "Quantity available",
    type: "number_integer",
  },
  {
    key: "availability_note",
    name: "Availability note",
    type: "single_line_text_field",
  },
  { key: "city", name: "City", type: "single_line_text_field" },
  { key: "state", name: "State", type: "single_line_text_field" },
  {
    key: "arrangements",
    name: "Arrangements",
    type: "list.single_line_text_field",
  },
  {
    key: "arrangements_note",
    name: "Arrangements note",
    type: "single_line_text_field",
  },
  { key: "photos", name: "Photos", type: "list.url" },
  { key: "seller_display", name: "Seller", type: "single_line_text_field" },
  { key: "public_status", name: "Status", type: "single_line_text_field" },
  { key: "live_at", name: "Live from", type: "date_time" },
  { key: "expires_at", name: "Expires", type: "date_time" },
  {
    key: "listing_ref",
    name: "Listing reference",
    type: "single_line_text_field",
  },
];

export const PUBLIC_KEYS = FIELD_DEFINITIONS.map((field) => field.key);

/** How the seller's stored choices (workspace) read on the page. */
const ARRANGEMENTS = { PICKUP: "Pickup", SHIPPING: "Shipping", OTHER: "Other" };
const PRIVATE_SELLER = "Private seller";

// DECISION (F06-T2): an empty value clears the field, so a value the seller removed (a
// quantity, a note) disappears from the page instead of keeping its old text.
const text = (value, max = 5000) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/**
 * The name shown as the seller: one word at most, so a full name typed into it can't put a
 * last name on the page.
 * @param {string | null} value
 */
export function sellerName(value) {
  const shown = text(value, 40);
  if (!shown || shown === PRIVATE_SELLER) return PRIVATE_SELLER;
  return shown.split(/\s+/)[0];
}

/**
 * Only addresses on our CloudFront domain are kept.
 * @param {string[]} urls
 * @returns {string[]}
 */
export function cloudFrontOnly(urls) {
  const domain = process.env.CLOUDFRONT_DOMAIN;
  if (!domain) return [];
  const prefix = `https://${domain}/`;
  return urls.filter(
    (url) =>
      typeof url === "string" &&
      url.startsWith(prefix) &&
      !/["'<>\s]/.test(url),
  );
}

/** @param {number | null} cents @param {string} currency */
const money = (cents, currency) =>
  Number.isInteger(cents) && /** @type {number} */ (cents) >= 0
    ? JSON.stringify({
        amount: /** @type {number} */ (cents / 100).toFixed(2),
        currency_code: currency,
      })
    : "";

const isoDate = (date) => (date instanceof Date ? date.toISOString() : "");

/**
 * The page of an open listing.
 * @param {Publishable} listing
 * @param {string[]} photoUrls from `media.publish()` or `media.getPublicUrls()`
 * @param {{ currency: string }} shop
 * @returns {Field[]} one entry per key in `PUBLIC_KEYS`, in that order
 */
export function buildFields(listing, photoUrls, { currency }) {
  /** @type {Record<string, string>} */
  const values = {
    title: text(listing.title, 255),
    condition: text(listing.condition, 255),
    description: text(listing.description),
    known_issues: text(listing.knownIssues),
    contents: text(listing.contents),
    asking_price: money(listing.askingPriceCents, currency),
    quantity_available: Number.isInteger(listing.quantityAvailable)
      ? String(listing.quantityAvailable)
      : "",
    availability_note: text(listing.availabilityNote, 255),
    city: text(listing.city, 100),
    state: text(listing.state, 100),
    arrangements: JSON.stringify(
      (listing.arrangements ?? [])
        .filter((item) => Object.hasOwn(ARRANGEMENTS, item))
        .map((item) => ARRANGEMENTS[item]),
    ),
    arrangements_note: text(listing.arrangementsNote, 255),
    photos: JSON.stringify(cloudFrontOnly(photoUrls)),
    seller_display: sellerName(listing.sellerDisplay),
    public_status: "live",
    live_at: isoDate(listing.liveAt),
    expires_at: isoDate(listing.expiresAt),
    listing_ref: listing.id,
  };
  return PUBLIC_KEYS.map((key) => ({ key, value: values[key] }));
}

/**
 * The page of a closed listing: the title and "closed", every other field emptied, so the
 * no-longer-available page shows nothing about the seller or the item.
 * @param {Publishable} listing
 * @returns {Field[]}
 */
export function closedFields(listing) {
  return FIELD_DEFINITIONS.map(({ key, type }) => {
    if (key === "title") return { key, value: text(listing.title, 255) };
    if (key === "public_status") return { key, value: "closed" };
    if (key === "listing_ref") return { key, value: listing.id };
    return { key, value: type.startsWith("list.") ? "[]" : "" };
  });
}

/**
 * The page's address: the title as a slug plus the end of the listing id, so two listings
 * with the same title never share one. Set once and stored; a later title change keeps it.
 * @param {Publishable} listing
 * @returns {string}
 */
export function makeHandle(listing) {
  const slug = text(listing.title, 200)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  return `${slug || "listing"}-${listing.id.slice(-6).toLowerCase()}`;
}
