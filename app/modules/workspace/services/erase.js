// Privacy redact (F08-T5): blank the network details kept with a terms acceptance.
// The acceptance itself (listing, rules version, time) is kept as the agreement record.
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
