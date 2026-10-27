// What ops needs to know about listings, for the deadline, reminder and retention tasks.
// Read-only selects of `Listing` fields, kept in this one file. The seller's email and name
// come from `access.getSellerContacts()` (F08-FIX-3). Ops writes nothing to these tables:
// every status change goes through core `transition()`.
import prisma from "@/db.server";
import {
  TERMINAL_STATUSES,
  countAuditEntries,
  listingsWithAuditEntry,
} from "@/modules/core/index.js";
import { DAY_MS } from "./shop.js";

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

/** Listings per page. At most 333: reminders check 3 keys per listing, 1000 per call. */
const PAGE = 200;

/** A task stops after this long; its scheduler time box is 60 s. */
const BUDGET_MS = 45_000;

/** @typedef {{ stopAt: number, expired: () => boolean }} Budget */

/**
 * A task's time budget, checked before each listing (F08-FIX-4).
 * @param {number} [budgetMs]
 * @returns {Budget}
 */
export function startBudget(budgetMs = BUDGET_MS) {
  const stopAt = Date.now() + budgetMs;
  return { stopAt, expired: () => Date.now() >= stopAt };
}

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
 * Prisma cursor, so a row that stops matching mid-run (expired) doesn't break the paging.
 * DECISION (F08-FIX-4): the consumer checks `budget` before each listing and paging stops
 * once it has passed. The next run starts again from the nearest deadline; the deadlines'
 * rows stop matching once handled, and reminders and the closed-email backstop leave out
 * the rows already sent before spending budget (F08-FIX-5), so the leftover waits an hour
 * at most.
 * @param {import("@prisma/client").Prisma.ListingWhereInput} where
 * @param {string} field one of PAGE_FIELDS; rows must have it set
 * @param {{ pageSize?: number, budget?: Budget }} [options]
 * @returns {AsyncGenerator<OpsListing[]>}
 */
export async function* listingPages(
  where,
  field,
  { pageSize = PAGE, budget = startBudget() } = {},
) {
  if (!PAGE_FIELDS.has(field)) throw new Error(`Unknown page field: ${field}`);
  /** @type {OpsListing | null} */
  let last = null;
  while (!budget.expired()) {
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
  }
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

/** The audit action ops writes when a listing is first held in a window (F08-FIX-4). */
export const RETIRE_HELD = "PageRetireHeld";

/**
 * Closed listings that still have a storefront page and closed before `cutoff`. Only ids:
 * the page fields belong to publishing, which reads them itself. A listing whose retirement
 * failed `maxFailures` times in the last `windowDays` is `held` instead of `due`, so it
 * can't block the batch, and is offered again once those failures age out.
 * DECISION (F08-FIX-6): the failures and holds are read through core `countAuditEntries()` /
 * `listingsWithAuditEntry()`, 500 ids a call. Every candidate id is read (ids only, no cap):
 * hourly retirement of 20 keeps the backlog small, and a cap would hide held listings past it.
 * DECISION (F08-FIX-4): "first held" means no `PageRetireHeld` row since the window start,
 * so no state is stored: at most one entry per listing per window.
 * @param {Date} cutoff
 * @param {number} take
 * @param {{ maxFailures?: number, windowDays?: number, now?: Date }} [options]
 * @returns {Promise<{
 *   due: Array<{ id: string }>,
 *   held: string[],
 *   newlyHeld: Array<{ id: string, failures: number }>,
 * }>} due oldest close first
 */
export async function findPagesToRetire(
  cutoff,
  take,
  { maxFailures = 3, windowDays = 7, now = new Date() } = {},
) {
  const where = {
    status: { in: [...TERMINAL_STATUSES] },
    metaobjectGid: { not: null },
    closedAt: { lte: cutoff },
  };
  const since = new Date(now.getTime() - windowDays * DAY_MS);
  const candidates = await prisma.listing.findMany({
    where,
    select: { id: true },
    orderBy: [{ closedAt: "asc" }, { id: "asc" }],
  });
  const ids = candidates.map(({ id }) => id);
  /** @type {Map<string, number>} */
  const failures = new Map();
  for (const listingIds of chunks(ids, AUDIT_CHUNK)) {
    const counts = await countAuditEntries({
      action: RETIRE_FAILED,
      listingIds,
      since,
    });
    for (const [id, count] of counts) failures.set(id, count);
  }
  const held = ids.filter((id) => (failures.get(id) ?? 0) >= maxFailures);
  const heldSet = new Set(held);
  const due = candidates.filter(({ id }) => !heldSet.has(id)).slice(0, take);
  if (held.length === 0) return { due, held, newlyHeld: [] };
  /** @type {Set<string>} */
  const seen = new Set();
  for (const listingIds of chunks(held, AUDIT_CHUNK)) {
    const marked = await listingsWithAuditEntry({
      action: RETIRE_HELD,
      listingIds,
      since,
    });
    for (const id of marked) seen.add(id);
  }
  const newlyHeld = held
    .filter((id) => !seen.has(id))
    .map((id) => ({ id, failures: /** @type {number} */ (failures.get(id)) }));
  return { due, held, newlyHeld };
}

/** Most ids core's audit helpers take in one call. */
const AUDIT_CHUNK = 500;

/**
 * @param {string[]} ids
 * @param {number} size
 * @returns {string[][]}
 */
function chunks(ids, size) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
