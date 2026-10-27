// The shop, for code that runs without a request (tasks and listeners).
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

/** @param {Date} date @returns {string} e.g. "October 12, 2026", in the shop's timezone */
export function formatDay(date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: shopTimeZone(),
  }).format(date);
}

/** @param {unknown} name @returns {string} the first word of the seller's name */
export const firstName = (name) =>
  String(name ?? "")
    .trim()
    .split(/\s+/)[0] ?? "";

/** @param {unknown} error @returns {string} the error's type only, for logs */
export const errorCode = (error) => error?.code ?? error?.name ?? "Error";

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
