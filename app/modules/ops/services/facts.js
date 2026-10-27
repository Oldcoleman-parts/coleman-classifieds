// What ops needs to know about listings, for the deadline, reminder and retention tasks.
// Read-only selects of `Listing` fields, kept in this one file. The seller's email and name
// come from `access.getSellerContacts()` (F08-FIX-3). Ops writes nothing to these tables:
// every status change goes through core `transition()`.
import prisma from "@/db.server";
import { TERMINAL_STATUSES } from "@/modules/core/index.js";

/**
 * @typedef {object} OpsListing
 * @property {string} id
 * @property {string} status
 * @property {string | null} title
 * @property {Date | null} draftDueBy
 * @property {Date | null} expiresAt
 * @property {Date | null} closedAt
 * @property {string | null} closedReason
 */

const SELECT = {
  id: true,
  status: true,
  title: true,
  draftDueBy: true,
  expiresAt: true,
  closedAt: true,
  closedReason: true,
};

/** At most this many listings a task run; the rest wait for the next hour. */
const BATCH = 200;

/**
 * @param {import("@prisma/client").Prisma.ListingWhereInput} where
 * @returns {Promise<OpsListing[]>} oldest first
 */
export function findListings(where) {
  return prisma.listing.findMany({
    where,
    select: SELECT,
    orderBy: { createdAt: "asc" },
    take: BATCH,
  });
}

/**
 * @param {string} listingId
 * @returns {Promise<OpsListing | null>}
 */
export function loadListing(listingId) {
  return prisma.listing.findUnique({
    where: { id: listingId },
    select: SELECT,
  });
}

/**
 * Closed listings that still have a storefront page and closed before `cutoff`. Only ids:
 * the page fields belong to publishing, which reads them itself.
 * @param {Date} cutoff
 * @param {number} take
 * @returns {Promise<Array<{ id: string }>>} oldest close first
 */
export function findPagesToRetire(cutoff, take) {
  return prisma.listing.findMany({
    where: {
      status: { in: [...TERMINAL_STATUSES] },
      metaobjectGid: { not: null },
      closedAt: { lte: cutoff },
    },
    select: { id: true },
    orderBy: { closedAt: "asc" },
    take,
  });
}
