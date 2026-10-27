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
 * @property {Date | null} correctionDueBy
 * @property {Date | null} expiresAt
 * @property {Date | null} overdueSince
 * @property {Date | null} closedAt
 * @property {string | null} closedReason
 */

const SELECT = {
  id: true,
  status: true,
  title: true,
  draftDueBy: true,
  correctionDueBy: true,
  expiresAt: true,
  overdueSince: true,
  closedAt: true,
  closedReason: true,
};

/** Listings per page. */
const PAGE = 200;

/** A task stops paging after this long; its scheduler time box is 60 s. */
const BUDGET_MS = 45_000;

/** The deadline fields a task may page by. */
const PAGE_FIELDS = new Set([
  "draftDueBy",
  "correctionDueBy",
  "expiresAt",
  "closedAt",
  "overdueSince",
]);

/**
 * Every matching listing, in pages ordered by `field` then id (nearest deadline first).
 * DECISION (F08-FIX-1): pages start after the last row's (field, id) value instead of a
 * Prisma cursor, so a row that stops matching mid-run (expired, reminded) doesn't break the
 * paging. Paging stops once `budgetMs` has passed; the next run starts again from the
 * nearest deadline, so the work left over waits an hour at most.
 * @param {import("@prisma/client").Prisma.ListingWhereInput} where
 * @param {string} field one of PAGE_FIELDS; rows must have it set
 * @param {{ pageSize?: number, budgetMs?: number }} [options]
 * @returns {AsyncGenerator<OpsListing[]>}
 */
export async function* listingPages(
  where,
  field,
  { pageSize = PAGE, budgetMs = BUDGET_MS } = {},
) {
  if (!PAGE_FIELDS.has(field)) throw new Error(`Unknown page field: ${field}`);
  const stopAt = Date.now() + budgetMs;
  /** @type {OpsListing | null} */
  let last = null;
  do {
    const after = last
      ? {
          OR: [
            { [field]: { gt: last[field] } },
            { [field]: last[field], id: { gt: last.id } },
          ],
        }
      : {};
    const page = await prisma.listing.findMany({
      where: { AND: [where, { [field]: { not: null } }, after] },
      select: SELECT,
      orderBy: [{ [field]: "asc" }, { id: "asc" }],
      take: pageSize,
    });
    if (page.length > 0) yield page;
    if (page.length < pageSize) return;
    last = page[page.length - 1];
  } while (Date.now() < stopAt);
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

/** The audit action ops writes when a page retirement fails. */
export const RETIRE_FAILED = "PageRetireFailed";

/**
 * Closed listings that still have a storefront page and closed before `cutoff`. Only ids:
 * the page fields belong to publishing, which reads them itself. A listing whose retirement
 * has failed `maxFailures` times is `held` instead of `due`, so it can't block the batch.
 * DECISION (F08-FIX-1): the failures are counted from ops' own `PageRetireFailed` audit
 * rows, read-only, as access and console read the audit log; a core counting helper is a
 * proposed follow-up.
 * @param {Date} cutoff
 * @param {number} take
 * @param {{ maxFailures?: number }} [options]
 * @returns {Promise<{ due: Array<{ id: string }>, held: string[] }>} due oldest close first
 */
export async function findPagesToRetire(
  cutoff,
  take,
  { maxFailures = 3 } = {},
) {
  const where = {
    status: { in: [...TERMINAL_STATUSES] },
    metaobjectGid: { not: null },
    closedAt: { lte: cutoff },
  };
  const failed = await prisma.auditEvent.groupBy({
    by: ["listingId"],
    where: { action: RETIRE_FAILED, listingId: { not: null } },
    having: { listingId: { _count: { gte: maxFailures } } },
  });
  const stuck = failed.map(
    ({ listingId }) => /** @type {string} */ (listingId),
  );
  const [due, held] = await Promise.all([
    prisma.listing.findMany({
      where: { ...where, id: { notIn: stuck } },
      select: { id: true },
      orderBy: { closedAt: "asc" },
      take,
    }),
    stuck.length === 0
      ? []
      : prisma.listing.findMany({
          where: { ...where, id: { in: stuck } },
          select: { id: true },
        }),
  ]);
  return { due, held: held.map(({ id }) => id) };
}
