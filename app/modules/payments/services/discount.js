// The single-use discount code that brings the fee product's price down to the fee locked
// on the invitation.
import { createHmac } from "node:crypto";
import prisma from "@/db.server";
import { ShopifyUserError, writeAudit } from "@/modules/core/index.js";
import { adminGraphql } from "@/modules/platform/index.js";
import { DAY_MS } from "./constants.js";
import { derivedKey } from "./crypto.js";
import { AWAITING } from "./facts.js";
import {
  DISCOUNT_BY_CODE,
  DISCOUNT_CREATE,
  DISCOUNT_DELETE,
  DISCOUNT_UPDATE,
} from "./graphql/admin.js";
import { toCents } from "./shop.js";

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

/** @param {object | null | undefined} node a code discount node @returns {number} NaN if unknown */
const amountOf = (node) =>
  toCents(node?.codeDiscount?.customerGets?.value?.amount?.amount);

/** @param {number} cents @param {string} feeVariantGid */
const customerGets = (cents, feeVariantGid) => ({
  value: {
    discountAmount: {
      amount: (cents / 100).toFixed(2),
      appliesOnEachItem: false,
    },
  },
  items: { products: { productVariantsToAdd: [feeVariantGid] } },
});

/**
 * Create the listing's discount code in Shopify, or adopt it when it already exists, and
 * make its amount `amountCents`.
 * DECISION (F06-FIX-1): the code is looked up by its text first, not by the stored id: the
 * text names this approval (listing and deadline), a stored id may belong to an earlier one.
 * A code made before a fee change has its amount changed in place.
 * @param {Payable} payable approved and awaiting payment
 * @param {{ admin: GraphqlClient, feeVariantGid: string, amountCents: number, now?: Date }} context
 *   `amountCents` from `discountFor()`: the fee variant's current price minus the locked fee
 * @returns {Promise<{ code: string | null }>} null when no discount is needed
 */
export async function ensureDiscount(
  payable,
  { admin, feeVariantGid, amountCents, now = new Date() },
) {
  if (!(amountCents > 0) || !payable.paymentDueBy) return { code: null };
  const code = discountCodeFor(payable.id, payable.paymentDueBy);

  const lookUp = async () =>
    (await adminGraphql(admin, DISCOUNT_BY_CODE, { code }))
      ?.codeDiscountNodeByCode ?? null;

  let node = await lookUp();
  let created = false;
  if (!node) {
    try {
      const data = await adminGraphql(admin, DISCOUNT_CREATE, {
        discount: {
          title: `Classifieds fee ${payable.id}`,
          code,
          startsAt: now.toISOString(),
          // DECISION (F06-T1): the code outlives the deadline by a day, so a seller who opened
          // the checkout in time can finish paying. No new checkout starts after the deadline.
          endsAt: new Date(
            payable.paymentDueBy.getTime() + DAY_MS,
          ).toISOString(),
          usageLimit: 1,
          appliesOncePerCustomer: false,
          context: { all: "ALL" },
          customerGets: customerGets(amountCents, feeVariantGid),
          combinesWith: {
            orderDiscounts: false,
            productDiscounts: false,
            shippingDiscounts: false,
          },
        },
      });
      node = data?.discountCodeBasicCreate?.codeDiscountNode ?? null;
      created = true;
    } catch (error) {
      // Another request created it a moment ago: adopt it.
      if (!hasCode(error, "TAKEN")) throw error;
      node = await lookUp();
    }
  }
  const id = node?.id;
  if (typeof id !== "string" || id === "")
    throw new ShopifyUserError("Shopify returned no discount id");

  const before = amountOf(node);
  if (!created && before !== amountCents) {
    await adminGraphql(admin, DISCOUNT_UPDATE, {
      id,
      discount: { customerGets: customerGets(amountCents, feeVariantGid) },
    });
    await writeAudit({
      action: "DiscountAmountChanged",
      listingId: payable.id,
      details: {
        discountCodeId: id,
        fromCents: Number.isFinite(before) ? before : null,
        toCents: amountCents,
      },
    });
  }

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
        details: { discountCodeId: id, amountCents },
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
