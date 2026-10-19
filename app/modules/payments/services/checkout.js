// Start the Shopify checkout for one approved listing: a cart with the fee product, the
// listing id as a cart attribute, the seller's email and the listing's discount code.
import { AppError, ConflictError, writeAudit } from "@/modules/core/index.js";
import { storefrontGraphql } from "@/modules/platform/index.js";
import { LISTING_ATTRIBUTE, STOREFRONT_API_VERSION } from "./constants.js";
import { discountCodeFor } from "./discount.js";
import { canPay, discountCents } from "./facts.js";
import { CART_CREATE } from "./graphql/storefront.js";
import { ensureFeeSetup } from "./setup.js";
import { storefrontBase } from "./shop.js";

/**
 * @typedef {import("./facts.js").Payable} Payable
 * @typedef {import("@/modules/platform/services/graphql.js").GraphqlClient} GraphqlClient
 */

/** @type {typeof fetch} */
let doFetch = (...args) => fetch(...args);

/** Replace `fetch` for Storefront calls (tests). Pass nothing to restore it. */
export function setStorefrontFetch(next) {
  doFetch = next ?? ((...args) => fetch(...args));
}

/**
 * A Storefront client that uses the app's own token. The token is never logged.
 * @param {string} shop the `*.myshopify.com` domain
 * @param {string} token
 * @returns {GraphqlClient}
 */
const storefrontClient = (shop, token) => ({
  graphql: (query, { variables } = {}) =>
    doFetch(`https://${shop}/api/${STOREFRONT_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(8000),
    }),
});

const toCents = (amount) => Math.round(Number(amount) * 100);

/**
 * @param {Payable} payable
 * @param {{ admin: GraphqlClient, shop: string, now?: Date }} context
 * @returns {Promise<{ checkoutUrl: string }>}
 * @throws {ConflictError} when the listing is not awaiting payment or its deadline has passed
 * @throws {AppError} code `CHECKOUT_PRICE` when the cart would not charge the locked fee
 */
export async function createCheckout(
  payable,
  { admin, shop, now = new Date() },
) {
  // The fee comes from the invitation and the deadline from the listing: never the client.
  if (!canPay(payable, now))
    throw new ConflictError("This listing can't be paid for now");
  const due = /** @type {Date} */ (payable.paymentDueBy);
  const { feeVariantGid, storefrontToken } = await ensureFeeSetup({ admin });
  const code =
    discountCents(payable) > 0 ? discountCodeFor(payable.id, due) : null;

  const data = await storefrontGraphql(
    storefrontClient(shop, storefrontToken),
    CART_CREATE,
    {
      input: {
        lines: [{ merchandiseId: feeVariantGid, quantity: 1 }],
        attributes: [{ key: LISTING_ATTRIBUTE, value: payable.id }],
        buyerIdentity: { email: payable.invitation.sellerEmail },
        ...(code ? { discountCodes: [code] } : {}),
      },
    },
  );
  const cart = data?.cartCreate?.cart;

  // No checkout unless Shopify will charge exactly the fee locked on the invitation.
  const applied =
    !code ||
    (cart?.discountCodes ?? []).some(
      (entry) =>
        entry.applicable && entry.code?.toUpperCase() === code.toUpperCase(),
    );
  const total = toCents(cart?.cost?.totalAmount?.amount);
  if (!applied || total !== payable.invitation.feeOfferedCents)
    throw new AppError("The checkout would not charge the listing fee", {
      code: "CHECKOUT_PRICE",
      details: { discountApplied: applied },
    });

  let url;
  try {
    url = new URL(cart.checkoutUrl);
  } catch {
    url = null;
  }
  const hosts = [shop, new URL(await storefrontBase(admin, shop)).host];
  if (url?.protocol !== "https:" || !hosts.includes(url.host))
    throw new AppError("Shopify returned an unexpected checkout address", {
      code: "CHECKOUT_URL",
    });

  await writeAudit({ action: "CheckoutStarted", listingId: payable.id });
  return { checkoutUrl: url.href };
}
