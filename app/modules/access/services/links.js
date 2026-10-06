// The full storefront address of a seller link.
import { adminGraphql } from "@/modules/platform/index.js";
import { SHOP_PRIMARY_DOMAIN } from "./graphql/shop.js";
import { sellerPath } from "./seller-pages.js";

/** @type {Map<string, string>} shop → https base, cached for the life of the process */
const bases = new Map();

/**
 * The storefront base address: the shop's primary domain, else its myshopify domain.
 * DECISION: links use the customer-facing domain so sellers see oldcolemanparts.com.
 * @param {import("@/modules/platform/services/graphql.js").GraphqlClient} admin
 * @param {string} shop
 * @returns {Promise<string>} always https, no trailing slash
 */
export async function storefrontBase(admin, shop) {
  const cached = bases.get(shop);
  if (cached) return cached;
  let base = `https://${shop}`;
  try {
    const data = await adminGraphql(admin, SHOP_PRIMARY_DOMAIN);
    const url = new URL(data?.shop?.primaryDomain?.url ?? "");
    if (url.protocol === "https:") base = url.origin;
  } catch (error) {
    console.error(
      `[access] primary domain lookup failed: ${error?.name ?? "Error"}`,
    );
  }
  bases.set(shop, base);
  return base;
}

/**
 * @param {string} base from `storefrontBase()`
 * @param {string} token never logged
 */
export const sellerLink = (base, token) => `${base}${sellerPath(token)}`;

/** Forget cached bases (tests). */
export function resetLinkCache() {
  bases.clear();
}
