// The shop, for code that runs without a request (event handlers and tasks).
import { getLinkUrl } from "@/modules/access/index.js";
import { AppError, shopTimeZone } from "@/modules/core/index.js";
import { adminFor } from "@/modules/platform/index.js";

/** @typedef {import("@/modules/platform/services/graphql.js").GraphqlClient} GraphqlClient */

/** @type {GraphqlClient | null} */
let testAdmin = null;

/** @returns {string} the store's `*.myshopify.com` domain, from SHOP_DOMAIN */
export function shopDomain() {
  const shop = process.env.SHOP_DOMAIN;
  if (!shop) throw new AppError("SHOP_DOMAIN is not set", { code: "CONFIG" });
  return shop;
}

/** @returns {Promise<GraphqlClient>} an Admin client from the stored offline session */
export async function offlineAdmin() {
  return testAdmin ?? adminFor(shopDomain());
}

/** Use this client instead of the offline session (tests). */
export function setOfflineAdmin(admin) {
  testAdmin = admin;
}

/**
 * The storefront address (https, no trailing slash), the same one seller links use.
 * @param {GraphqlClient} admin
 * @param {string} shop
 * @returns {Promise<string>}
 */
export async function storefrontBase(admin, shop) {
  return new URL(await getLinkUrl(admin, shop)).origin;
}

/** @param {Date} date @returns {string} e.g. "October 12, 2026", in the shop's timezone */
export function formatDay(date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: shopTimeZone(),
  }).format(date);
}

/** @param {unknown} amount a Shopify money string, e.g. "30.50" @returns {number} NaN when it isn't one */
export const toCents = (amount) => Math.round(Number(amount) * 100);

/** @param {number} cents @returns {string} e.g. "$30.00" */
export const money = (cents) => `$${(cents / 100).toFixed(2)}`;
