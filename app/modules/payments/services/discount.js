// The single-use discount code that brings the fee product's price down to the fee locked
// on the invitation.
import { createHmac } from "node:crypto";
import prisma from "@/db.server";
import { ShopifyUserError, writeAudit } from "@/modules/core/index.js";
import { adminGraphql } from "@/modules/platform/index.js";
import { DAY_MS } from "./constants.js";
import { derivedKey } from "./crypto.js";
import { AWAITING, discountCents } from "./facts.js";
import {
  DISCOUNT_BY_CODE,
  DISCOUNT_CREATE,
  DISCOUNT_DELETE,
} from "./graphql/admin.js";

/**
 * @typedef {import("./facts.js").Payable} Payable
 * @typedef {import("@/modules/platform/services/graphql.js").GraphqlClient} GraphqlClient
 */

/**
 * DECISION (F06-T1): the code is derived (HMAC of the listing and its payment deadline), not
 * stored: it can't be guessed, a repeated approval gives the same code, and a re-issue gives
 * a new one. Only the Shopify id is kept, in `Listing.discountCodeId`.
 * @param {string} listingId
 * @param {Date} paymentDueBy
 * @returns {string} e.g. "OCP-3F9A61C07B2D48E5"
 */
export function discountCodeFor(listingId, paymentDueBy) {
  const digest = createHmac("sha256", derivedKey("cc-discount-v1"))
    .update(`${listingId}:${paymentDueBy.getTime()}`)
    .digest("hex");
  return `OCP-${digest.slice(0, 16).toUpperCase()}`;
}

const hasCode = (error, code) =>
  error instanceof ShopifyUserError &&
  error.userErrors.some((problem) => problem.code === code);

/**
 * Create the listing's discount code in Shopify, or adopt it when it already exists.
 * @param {Payable} payable approved and awaiting payment
 * @param {{ admin: GraphqlClient, feeVariantGid: string, now?: Date }} context
 * @returns {Promise<{ code: string | null }>} null when the offered fee is the regular fee
 */
export async function ensureDiscount(
  payable,
  { admin, feeVariantGid, now = new Date() },
) {
  const cents = discountCents(payable);
  if (cents === 0 || !payable.paymentDueBy) return { code: null };
  const code = discountCodeFor(payable.id, payable.paymentDueBy);

  let id;
  try {
    const data = await adminGraphql(admin, DISCOUNT_CREATE, {
      discount: {
        title: `Classifieds fee ${payable.id}`,
        code,
        startsAt: now.toISOString(),
        // DECISION (F06-T1): the code outlives the deadline by a day, so a seller who opened
        // the checkout in time can finish paying. No new checkout starts after the deadline.
        endsAt: new Date(payable.paymentDueBy.getTime() + DAY_MS).toISOString(),
        usageLimit: 1,
        appliesOncePerCustomer: false,
        context: { all: "ALL" },
        customerGets: {
          value: {
            discountAmount: {
              amount: (cents / 100).toFixed(2),
              appliesOnEachItem: false,
            },
          },
          items: { products: { productVariantsToAdd: [feeVariantGid] } },
        },
        combinesWith: {
          orderDiscounts: false,
          productDiscounts: false,
          shippingDiscounts: false,
        },
      },
    });
    id = data?.discountCodeBasicCreate?.codeDiscountNode?.id;
  } catch (error) {
    // The same approval was handled before: the code exists, so look its id up.
    if (!hasCode(error, "TAKEN")) throw error;
    const data = await adminGraphql(admin, DISCOUNT_BY_CODE, { code });
    id = data?.codeDiscountNodeByCode?.id;
  }
  if (typeof id !== "string" || id === "")
    throw new ShopifyUserError("Shopify returned no discount id");

  if (id !== payable.discountCodeId) {
    // Only while this approval still stands: a lapse or a re-issue in between wins.
    const { count } = await prisma.listing.updateMany({
      where: {
        id: payable.id,
        status: AWAITING,
        paymentDueBy: payable.paymentDueBy,
      },
      data: { discountCodeId: id },
    });
    if (count === 1)
      await writeAudit({
        action: "DiscountCreated",
        listingId: payable.id,
        details: { discountCodeId: id, amountCents: cents },
      });
  }
  return { code };
}

/**
 * Delete a listing's discount code in Shopify and forget its id. A code that is already
 * gone counts as deleted.
 * @param {{ id: string, discountCodeId: string | null }} listing
 * @param {{ admin: GraphqlClient }} context
 * @returns {Promise<boolean>} true when there was a code to forget
 */
export async function deleteDiscount(listing, { admin }) {
  const id = listing.discountCodeId;
  if (!id) return false;
  try {
    await adminGraphql(admin, DISCOUNT_DELETE, { id });
  } catch (error) {
    if (!hasCode(error, "NOT_FOUND") && !hasCode(error, "INVALID")) throw error;
  }
  const { count } = await prisma.listing.updateMany({
    where: { id: listing.id, discountCodeId: id },
    data: { discountCodeId: null },
  });
  if (count === 1)
    await writeAudit({
      action: "DiscountDeleted",
      listingId: listing.id,
      details: { discountCodeId: id },
    });
  return count === 1;
}
