// Fixed names shared by the payments services.

/** The fee product is found by this handle before it is created, so it is never duplicated. */
export const FEE_HANDLE = "coleman-classifieds-listing-fee";
// DECISION (F06-T1): fee orders are recognised by this SKU (ShippingEasy excludes it), not by
// an order tag, so the app needs no `write_orders` scope.
export const FEE_SKU = "CLASSIFIEDS-FEE";
/** The cart attribute that names the listing. It only nominates one: see orders-paid.js. */
export const LISTING_ATTRIBUTE = "_classifieds_listing_id";
export const PAY_PATH = "/apps/classifieds/pay";
// Storefront calls with our own token; the same version as `app/shopify.server.js`.
export const STOREFRONT_API_VERSION = "2026-07";

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
