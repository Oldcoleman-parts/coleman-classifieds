// Privacy redact (F08-T5, F08-FIX-8): blank the network details kept with a terms acceptance,
// and the seller's display name and location on their listings. The acceptance itself
// (listing, rules version, time) is kept as the agreement record.
import prisma from "@/db.server";
import { requireIdList } from "@/modules/core/index.js";

const CHUNK = 500;

/**
 * Sets `ip` and `userAgent` to "" (both NOT NULL). Repeats change nothing.
 * @param {string[] | "all"} listingIds the seller's listings, or "all" (shop/redact)
 * @returns {Promise<{ terms: number }>}
 */
export async function eraseTermsNetworkData(listingIds) {
  const blank = { ip: "", userAgent: "" };
  const notBlank = { OR: [{ ip: { not: "" } }, { userAgent: { not: "" } }] };
  if (listingIds === "all") {
    const { count } = await prisma.termsAcceptance.updateMany({
      where: notBlank,
      data: blank,
    });
    return { terms: count };
  }
  // A seller has a handful of listings; any number is accepted, 500 ids a query.
  const all = requireIdList(listingIds, "listingIds", { max: Infinity });
  let terms = 0;
  for (let i = 0; i < all.length; i += CHUNK) {
    const ids = all.slice(i, i + CHUNK);
    const { count } = await prisma.termsAcceptance.updateMany({
      where: { listingId: { in: ids }, ...notBlank },
      data: blank,
    });
    terms += count;
  }
  return { terms };
}

/**
 * Blanks the seller's display name and location on their listings (F08-FIX-8). Revisions
 * only hold the title and description (`live.js`), so they need nothing. Repeats change
 * nothing.
 * @param {string[] | "all"} listingIds the seller's listings, or "all" (shop/redact)
 * @returns {Promise<{ listings: number }>}
 */
export async function eraseListingSellerData(listingIds) {
  const blank = { sellerDisplay: null, city: null, state: null };
  const notBlank = {
    OR: [
      { sellerDisplay: { not: null } },
      { city: { not: null } },
      { state: { not: null } },
    ],
  };
  if (listingIds === "all") {
    const { count } = await prisma.listing.updateMany({
      where: notBlank,
      data: blank,
    });
    return { listings: count };
  }
  const all = requireIdList(listingIds, "listingIds", { max: Infinity });
  let listings = 0;
  for (let i = 0; i < all.length; i += CHUNK) {
    const { count } = await prisma.listing.updateMany({
      where: { id: { in: all.slice(i, i + CHUNK) }, ...notBlank },
      data: blank,
    });
    listings += count;
  }
  return { listings };
}
