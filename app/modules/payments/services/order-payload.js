// Read the parts of Shopify's `orders/paid` and `refunds/create` payloads (and of an Admin
// API order, for the reconcile) that payments uses. Nothing here is trusted: every value is
// checked and anything odd becomes null.
import { LISTING_ATTRIBUTE } from "./constants.js";

/**
 * @typedef {object} FeeOrderFacts
 * @property {string} orderGid
 * @property {string | null} listingId the cart attribute, if it looks like an id
 * @property {boolean} hasAttribute the attribute is present (even with an odd value)
 * @property {Array<{ variantGid: string | null, quantity: number, priceCents: number | null }>} lines
 *   `priceCents` is the unit price before discounts
 * @property {number | null} subtotalCents after discounts, before tax and shipping
 * @property {string[]} discountCodes upper-cased
 * @property {boolean} hasShipping
 * @property {boolean} test
 */

const ID_RE = /^[a-z0-9]{1,40}$/i;
const MONEY_RE = /^\d{1,9}(\.\d{1,2})?$/;

/** @param {unknown} value a REST number id */
const numericId = (value) =>
  (typeof value === "number" && Number.isSafeInteger(value) && value > 0) ||
  (typeof value === "string" && /^\d{1,20}$/.test(value))
    ? String(value)
    : null;

/** @param {unknown} value e.g. "25.00" */
function cents(value) {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !MONEY_RE.test(text)) return null;
  return Math.round(Number(text) * 100);
}

const list = (value) => (Array.isArray(value) ? value : []);

/**
 * @param {unknown} payload the `orders/paid` body
 * @returns {FeeOrderFacts | null} null when it isn't an order
 */
export function readOrder(payload) {
  const order = /** @type {Record<string, unknown>} */ (payload ?? {});
  const id = numericId(order.id);
  if (!id) return null;
  const attribute = list(order.note_attributes).find(
    (entry) => entry?.name === LISTING_ATTRIBUTE,
  );
  const value = attribute?.value;
  return {
    orderGid: `gid://shopify/Order/${id}`,
    listingId: typeof value === "string" && ID_RE.test(value) ? value : null,
    hasAttribute: attribute !== undefined,
    lines: list(order.line_items).map((line) => {
      const variant = numericId(line?.variant_id);
      return {
        variantGid: variant ? `gid://shopify/ProductVariant/${variant}` : null,
        quantity: Number.isInteger(line?.quantity) ? line.quantity : 0,
        priceCents: cents(line?.price),
      };
    }),
    subtotalCents: cents(order.subtotal_price),
    discountCodes: list(order.discount_codes)
      .map((entry) => entry?.code)
      .filter((code) => typeof code === "string")
      .map((code) => code.toUpperCase()),
    hasShipping: list(order.shipping_lines).length > 0,
    test: order.test === true,
  };
}

const ORDER_GID_RE = /^gid:\/\/shopify\/Order\/\d{1,20}$/;
const VARIANT_GID_RE = /^gid:\/\/shopify\/ProductVariant\/\d{1,20}$/;

/** @param {unknown} set an Admin API `MoneyBag` */
const shopCents = (set) => cents(set?.shopMoney?.amount);

/**
 * The same facts as `readOrder()`, from an Admin API order node (`FEE_ORDERS_PAID`).
 * @param {unknown} node
 * @returns {FeeOrderFacts | null} null when it isn't an order
 */
export function readAdminOrder(node) {
  const order = /** @type {Record<string, any>} */ (node ?? {});
  if (typeof order.id !== "string" || !ORDER_GID_RE.test(order.id)) return null;
  const attribute = list(order.customAttributes).find(
    (entry) => entry?.key === LISTING_ATTRIBUTE,
  );
  const value = attribute?.value;
  return {
    orderGid: order.id,
    listingId: typeof value === "string" && ID_RE.test(value) ? value : null,
    hasAttribute: attribute !== undefined,
    lines: list(order.lineItems?.nodes).map((line) => {
      const variant = line?.variant?.id;
      return {
        variantGid:
          typeof variant === "string" && VARIANT_GID_RE.test(variant)
            ? variant
            : null,
        quantity: Number.isInteger(line?.quantity) ? line.quantity : 0,
        priceCents: shopCents(line?.originalUnitPriceSet),
      };
    }),
    subtotalCents: shopCents(order.subtotalPriceSet),
    discountCodes: list(order.discountCodes)
      .filter((code) => typeof code === "string")
      .map((code) => code.toUpperCase()),
    hasShipping: list(order.shippingLines?.nodes).length > 0,
    test: order.test === true,
  };
}

/**
 * @param {unknown} payload the `refunds/create` body
 * @returns {{ orderGid: string, refundId: string } | null}
 */
export function readRefund(payload) {
  const refund = /** @type {Record<string, unknown>} */ (payload ?? {});
  const order = numericId(refund.order_id);
  const id = numericId(refund.id);
  return order && id
    ? { orderGid: `gid://shopify/Order/${order}`, refundId: id }
    : null;
}
