// What payments needs to know about a listing and its locked fee.
// DECISION (F06-T1): read-only selects of `Listing` and `Invitation` kept in this one file.
// `core.getListingSummary()` has no payment fields and access has no lookup by listing id;
// follow-up: a core export for these facts. Payments writes only `Listing.discountCodeId`.
import prisma from "@/db.server";

/**
 * @typedef {object} Payable
 * @property {string} id
 * @property {string} status
 * @property {string | null} title
 * @property {Date | null} paymentDueBy
 * @property {string | null} discountCodeId
 * @property {Date | null} liveAt
 * @property {boolean} refundFlag
 * @property {{ sellerEmail: string, sellerName: string, feeRegularCents: number, feeOfferedCents: number }} invitation
 */

export const AWAITING = "APPROVED_AWAITING_PAYMENT";

const SELECT = {
  id: true,
  status: true,
  title: true,
  paymentDueBy: true,
  discountCodeId: true,
  liveAt: true,
  refundFlag: true,
  invitation: {
    select: {
      sellerEmail: true,
      sellerName: true,
      feeRegularCents: true,
      feeOfferedCents: true,
    },
  },
};

/**
 * @param {unknown} listingId
 * @returns {Promise<Payable | null>} null when there is no such listing
 */
export async function loadPayable(listingId) {
  if (typeof listingId !== "string" || !/^[a-z0-9]{1,40}$/i.test(listingId))
    return null;
  return prisma.listing.findUnique({
    where: { id: listingId },
    select: SELECT,
  });
}

/**
 * Listings in the given state, oldest deadline first.
 * @param {import("@prisma/client").Prisma.ListingWhereInput} where
 * @returns {Promise<Payable[]>}
 */
export function findPayables(where) {
  return prisma.listing.findMany({
    where,
    select: SELECT,
    orderBy: { paymentDueBy: "asc" },
    take: 200,
  });
}

/**
 * @param {Payable | null} payable
 * @param {Date} now
 * @returns {boolean} approved, unpaid and still inside its payment window
 */
export function canPay(payable, now) {
  return (
    payable?.status === AWAITING &&
    payable.paymentDueBy instanceof Date &&
    payable.paymentDueBy.getTime() > now.getTime()
  );
}

/**
 * The discount that brings the fee product's current price down to the locked fee.
 * DECISION (F06-FIX-1): based on the price in Shopify (kept equal to today's base fee), not on
 * `feeRegularCents`, so an invitation made before a fee change still pays its locked fee.
 * @param {Payable} payable
 * @param {number} priceCents the fee variant's current price
 * @returns {number} cents to take off; 0 = none; below 0 = the locked fee is above the price
 */
export const discountFor = (payable, priceCents) =>
  priceCents - payable.invitation.feeOfferedCents;
