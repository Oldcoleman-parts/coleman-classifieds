// Read-only audit log counts for other modules (F01-FIX-10). Only core queries `AuditEvent`;
// these return ids and counts, never the entry's details or actor. Writes are in events.js.
import prisma from "@/db.server";
import { ValidationError } from "./errors.js";
import { requireIdList, requireString } from "./validators.js";

/** Listing ids per call. */
const MAX_LISTING_IDS = 500;

/**
 * @typedef {object} AuditCountQuery
 * @property {string} action the audit action, for example `PageRetireFailed`
 * @property {string[]} listingIds at most 500; duplicates are dropped
 * @property {Date} since entries at or after this time count
 */

/**
 * @param {AuditCountQuery} query
 * @returns {{ action: string, ids: string[], since: Date }}
 */
function readQuery({ action, listingIds, since } = /** @type {any} */ ({})) {
  const checked = requireString(action, "action", { max: 100 });
  const ids = requireIdList(listingIds, "listingIds", {
    max: MAX_LISTING_IDS,
  });
  if (!(since instanceof Date) || Number.isNaN(since.getTime()))
    throw new ValidationError("since must be a date", {
      since: "must be a date",
    });
  return { action: checked, ids, since };
}

/**
 * How many entries of one action each listing has since a time.
 * DECISION (F01-FIX-10): one groupBy filtered on action, the ids and `at`; Postgres picks
 * the `[action, at]` or `[listingId, at]` index, both fit. An empty id list makes no query.
 * @param {AuditCountQuery} query
 * @returns {Promise<Map<string, number>>} listing id → count; listings with none are left out
 */
export async function countAuditEntries(query) {
  const { action, ids, since } = readQuery(query);
  if (ids.length === 0) return new Map();
  const rows = await prisma.auditEvent.groupBy({
    by: ["listingId"],
    where: { action, listingId: { in: ids }, at: { gte: since } },
    _count: { _all: true },
  });
  return new Map(
    rows.map((row) => [/** @type {string} */ (row.listingId), row._count._all]),
  );
}

/**
 * The listings that have at least one entry of one action since a time.
 * @param {AuditCountQuery} query
 * @returns {Promise<Set<string>>}
 */
export async function listingsWithAuditEntry(query) {
  return new Set((await countAuditEntries(query)).keys());
}
