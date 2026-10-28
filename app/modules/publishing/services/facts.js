// What publishing needs to know about a listing.
// DECISION (F06-T2): read-only selects of `Listing` (and the seller's email and name, for
// the seller's own emails only) kept in this one file, as payments does. Follow-up: a core
// export for these facts. Publishing writes only `metaobjectGid` and `metaobjectHandle`.
import prisma from "@/db.server";

/**
 * @typedef {object} Publishable
 * @property {string} id
 * @property {string} status
 * @property {string | null} title
 * @property {string | null} description
 * @property {number | null} askingPriceCents
 * @property {number | null} quantityAvailable
 * @property {string | null} availabilityNote
 * @property {string | null} condition
 * @property {string | null} knownIssues
 * @property {string | null} contents
 * @property {string | null} city
 * @property {string | null} state
 * @property {string[]} arrangements
 * @property {string | null} arrangementsNote
 * @property {string | null} sellerDisplay
 * @property {string | null} metaobjectGid
 * @property {string | null} metaobjectHandle
 * @property {Date | null} liveAt
 * @property {Date | null} expiresAt
 * @property {Date | null} closedAt
 * @property {{ sellerEmail: string, sellerName: string }} invitation never published
 */

const SELECT = {
  id: true,
  status: true,
  title: true,
  description: true,
  askingPriceCents: true,
  quantityAvailable: true,
  availabilityNote: true,
  condition: true,
  knownIssues: true,
  contents: true,
  city: true,
  state: true,
  arrangements: true,
  arrangementsNote: true,
  sellerDisplay: true,
  metaobjectGid: true,
  metaobjectHandle: true,
  liveAt: true,
  expiresAt: true,
  closedAt: true,
  invitation: { select: { sellerEmail: true, sellerName: true } },
};

/** Shown on the storefront as an open listing (a paused one is hidden, not closed). */
export const OPEN_STATUSES = ["LIVE", "PAUSED", "PAYMENT_OVERDUE"];
export const CLOSED_STATUSES = ["SOLD", "EXPIRED", "REMOVED"];

/**
 * @param {unknown} listingId
 * @returns {Promise<Publishable | null>}
 */
export async function loadListing(listingId) {
  if (typeof listingId !== "string" || !/^[a-z0-9]{1,40}$/i.test(listingId))
    return null;
  return prisma.listing.findUnique({
    where: { id: listingId },
    select: SELECT,
  });
}

/**
 * The listings whose storefront page the hourly task re-writes: every open one, and every
 * one that closed in the last `closedSince` and has a page.
 * @param {Date} closedSince
 * @returns {Promise<Publishable[]>}
 */
export function findListingsToSync(closedSince) {
  return prisma.listing.findMany({
    where: {
      OR: [
        { status: { in: OPEN_STATUSES } },
        { closedAt: { gte: closedSince }, metaobjectGid: { not: null } },
      ],
    },
    select: SELECT,
    orderBy: { liveAt: "asc" },
    take: 500,
  });
}

/** @returns {Promise<number>} the listings the storefront should show as live */
export const countLive = () =>
  prisma.listing.count({ where: { status: "LIVE" } });

/**
 * Remember where the listing's page is. Writes only when something changed.
 * @param {Publishable} listing
 * @param {{ gid: string | null, handle: string | null }} entry
 */
export async function saveEntry(listing, { gid, handle }) {
  if (listing.metaobjectGid === gid && listing.metaobjectHandle === handle)
    return;
  await prisma.listing.update({
    where: { id: listing.id },
    data: { metaobjectGid: gid, metaobjectHandle: handle },
  });
}
