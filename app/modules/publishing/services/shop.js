// The shop, for code that runs without a request (event handlers and tasks).
import { getLinkUrl } from "@/modules/access/index.js";
import { AppError, shopTimeZone } from "@/modules/core/index.js";
import { adminFor } from "@/modules/platform/index.js";
import { URL_HANDLE } from "./constants.js";

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
 * The public address of a listing page (https), on the same domain as seller links.
 * @param {GraphqlClient} admin
 * @param {string} handle
 * @returns {Promise<string>}
 */
export async function listingUrl(admin, handle) {
  const origin = new URL(await getLinkUrl(admin, shopDomain())).origin;
  return `${origin}/pages/${URL_HANDLE}/${handle}`;
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
