// Storefront addresses in alert emails: confirm, unsubscribe, browse and listing pages.
import { getLinkUrl } from "@/modules/access/index.js";
import { AppError } from "@/modules/core/index.js";
import { adminFor } from "@/modules/platform/index.js";
import { confirmToken, unsubscribeToken } from "./tokens.js";

/** @typedef {import("@/modules/platform/services/graphql.js").GraphqlClient} GraphqlClient */

export const ALERTS_PATH = "/apps/classifieds/alerts";
export const CONFIRM_PATH = `${ALERTS_PATH}/confirm`;
export const UNSUBSCRIBE_PATH = `${ALERTS_PATH}/unsubscribe`;
export const RESUBSCRIBE_PATH = `${ALERTS_PATH}/resubscribe`;
// Shared with publishing (constants.js): the merchant's browse page and the listing pages.
const BROWSE_PATH = "/pages/classifieds";
const LISTING_PATH = "/pages/classified-listing";

/** @type {GraphqlClient | null} */
let testAdmin = null;

/** Use this client instead of the offline session (tests). */
export function setAlertsAdmin(admin) {
  testAdmin = admin;
}

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

/**
 * The storefront origin (primary domain, https), the same one seller links use.
 * @param {{ admin?: GraphqlClient, shop?: string }} [context] a proxy request's, else offline
 * @returns {Promise<string>} no trailing slash
 */
export async function storefrontBase({ admin, shop } = {}) {
  const client = admin ?? (await offlineAdmin());
  return new URL(await getLinkUrl(client, shop ?? shopDomain())).origin;
}

/** @param {string} base @param {string} id */
export const confirmUrl = (base, id) => {
  const token = confirmToken(id);
  return { token, url: `${base}${CONFIRM_PATH}?t=${token}` };
};

/** @param {string} base @param {string} id */
export const unsubscribeUrl = (base, id) =>
  `${base}${UNSUBSCRIBE_PATH}?t=${unsubscribeToken(id)}`;

/** @param {string} base */
export const browseUrl = (base) => `${base}${BROWSE_PATH}`;

/** @param {string} base @param {string} handle */
export const listingUrl = (base, handle) => `${base}${LISTING_PATH}/${handle}`;
