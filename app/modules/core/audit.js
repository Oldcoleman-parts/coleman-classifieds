// Read-only access to the audit log for other modules. Only core queries `AuditEvent`;
// writes are in events.js. The counts (F01-FIX-10) return ids and counts only. The History
// reads (F01-FIX-11) return whole entries, with `details` and `actorRef`: they are for the
// staff-only protected history (console) and must never feed public output.
import prisma from "@/db.server";
import { ValidationError } from "./errors.js";
import {
  requireEnum,
  requireId,
  requireIdList,
  requireInt,
  requireString,
} from "./validators.js";

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

/**
 * @typedef {import("./types.js").AuditFilter} AuditFilter
 * @typedef {import("./types.js").AuditEntry} AuditEntry
 */

export const AUDIT_ACTORS = ["STAFF", "SELLER", "BUYER", "SYSTEM"];
// Audit actions are code names: `ListingApproved`, `privacy.customers_redact`.
const ACTION_RE = /^[A-Za-z0-9._-]{1,64}$/;
const FILTER_KEYS = [
  "listingId",
  "start",
  "end",
  "action",
  "actor",
  "actorRef",
];
const CURSOR_RE = /^(\d{1,15})_(.+)$/;
const MAX_TAKE = 200;
const MAX_BATCH = 1000;

/** @param {string} field @param {string} problem */
const invalid = (field, problem) =>
  new ValidationError(`${field} ${problem}`, { [field]: problem });

const isDate = (value) =>
  value instanceof Date && !Number.isNaN(value.getTime());

/**
 * Check a filter: every problem is reported in one `ValidationError`.
 * @param {AuditFilter} [filter]
 * @returns {import("@prisma/client").Prisma.AuditEventWhereInput}
 */
function readFilter(filter = {}) {
  if (!filter || typeof filter !== "object" || Array.isArray(filter))
    throw invalid("filter", "must be an object");
  /** @type {Record<string, string>} */
  const fields = {};
  const check = (run) => {
    try {
      run();
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      Object.assign(fields, error.fields);
    }
  };
  for (const key of Object.keys(filter))
    if (!FILTER_KEYS.includes(key)) fields[key] = "is not a filter";
  const { listingId, start, end, action, actor, actorRef } = filter;
  /** @type {import("@prisma/client").Prisma.AuditEventWhereInput[]} */
  const and = [];
  check(() => {
    if (listingId !== undefined)
      and.push({ listingId: requireId(listingId, "listingId") });
  });
  check(() => {
    if (action === undefined) return;
    if (typeof action !== "string" || !ACTION_RE.test(action))
      throw invalid("action", "is not a valid action");
    and.push({ action });
  });
  check(() => {
    if (actor !== undefined)
      and.push({ actor: requireEnum(actor, AUDIT_ACTORS, "actor") });
  });
  check(() => {
    if (actorRef !== undefined)
      and.push({
        actorRef: {
          equals: requireString(actorRef, "actorRef", { max: 320 }),
          mode: "insensitive",
        },
      });
  });
  check(() => {
    if (start !== undefined && !isDate(start))
      throw invalid("start", "must be a date");
    if (end !== undefined && !isDate(end))
      throw invalid("end", "must be a date");
    if (start && end && end <= start)
      throw invalid("end", "must be after the start");
    if (start || end)
      and.push({
        at: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) },
      });
  });
  if (Object.keys(fields).length > 0)
    throw new ValidationError("Check the audit filter", fields);
  return { AND: and };
}

/** @param {{ at: Date, id: string }} entry */
const cursorOf = ({ at, id }) => `${at.getTime()}_${id}`;

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {{ at: Date, id: string }}
 */
function parseCursor(value, field) {
  const match = typeof value === "string" ? CURSOR_RE.exec(value) : null;
  if (!match) throw invalid(field, "is not a valid cursor");
  return { at: new Date(Number(match[1])), id: requireId(match[2], field) };
}

/** @param {any} row @returns {AuditEntry} */
const toEntry = ({ listing, ...row }) => ({
  id: row.id,
  at: row.at,
  listingId: row.listingId,
  listingTitle: row.listingId ? (listing?.title ?? null) : null,
  action: row.action,
  actor: row.actor,
  actorRef: row.actorRef,
  details: row.details,
});

/**
 * Audit entries newest first, a page at a time, paged by `(at, id)` cursors: `after` reads
 * the next (older) page, `before` the previous (newer) one. A listing's timeline is
 * `listAuditEntries({ listingId }, { take: 200 })` (reverse it; `nextCursor` set means
 * there are older entries).
 * @param {AuditFilter} filter
 * @param {{ after?: string, before?: string, take?: number }} [page] take 1–200 (50)
 * @returns {Promise<{ entries: AuditEntry[], nextCursor: string | null,
 *   prevCursor: string | null }>}
 */
export async function listAuditEntries(filter, page) {
  const where = readFilter(filter);
  const { after, before, take: asked } = page ?? {};
  if (after !== undefined && before !== undefined)
    throw invalid("before", "can't be used with after");
  const take = requireInt(asked ?? 50, "take", { min: 1, max: MAX_TAKE });
  const cursor =
    after !== undefined
      ? parseCursor(after, "after")
      : before !== undefined
        ? parseCursor(before, "before")
        : null;
  const older = (c) => ({
    OR: [{ at: { lt: c.at } }, { at: c.at, id: { lt: c.id } }],
  });
  const newer = (c) => ({
    OR: [{ at: { gt: c.at } }, { at: c.at, id: { gt: c.id } }],
  });
  const backwards = before !== undefined;
  const rows = await prisma.auditEvent.findMany({
    where: {
      AND: [
        where,
        ...(cursor ? [backwards ? newer(cursor) : older(cursor)] : []),
      ],
    },
    orderBy: backwards
      ? [{ at: "asc" }, { id: "asc" }]
      : [{ at: "desc" }, { id: "desc" }],
    take: take + 1,
    include: { listing: { select: { title: true } } },
  });
  const more = rows.length > take;
  const pageRows = rows.slice(0, take);
  if (backwards) pageRows.reverse();
  const entries = pageRows.map(toEntry);
  const first = entries[0];
  const last = entries[entries.length - 1];
  return {
    entries,
    nextCursor: last && (backwards || more) ? cursorOf(last) : null,
    prevCursor:
      first && (backwards ? more : after !== undefined)
        ? cursorOf(first)
        : null,
  };
}

/**
 * Every entry of a filter for an export, oldest first in `(at, id)` order, read in batches.
 * The end is fixed when this is opened (the newest matching entry then), so entries written
 * afterwards (the export's own audit entry) stay out. Entries carry no listing title.
 * @param {AuditFilter} filter
 * @param {{ batchSize?: number }} [options] at most 1000 (500)
 * @returns {Promise<{ empty: boolean, next: () => Promise<AuditEntry[]> }>} `next()`
 *   returns `[]` once done
 */
export async function openAuditExport(filter, { batchSize = 500 } = {}) {
  const where = readFilter(filter);
  const size = requireInt(batchSize, "batchSize", { min: 1, max: MAX_BATCH });
  const last = await prisma.auditEvent.findFirst({
    where,
    orderBy: [{ at: "desc" }, { id: "desc" }],
    select: { at: true, id: true },
  });
  /** @type {{ at: Date, id: string } | null} */
  let cursor = null;
  let done = !last;
  return {
    empty: !last,
    async next() {
      if (done || !last) return [];
      const rows = await prisma.auditEvent.findMany({
        where: {
          AND: [
            where,
            {
              OR: [
                { at: { lt: last.at } },
                { at: last.at, id: { lte: last.id } },
              ],
            },
            ...(cursor
              ? [
                  {
                    OR: [
                      { at: { gt: cursor.at } },
                      { at: cursor.at, id: { gt: cursor.id } },
                    ],
                  },
                ]
              : []),
          ],
        },
        orderBy: [{ at: "asc" }, { id: "asc" }],
        take: size,
      });
      if (rows.length < size) done = true;
      if (rows.length > 0) {
        const tail = rows[rows.length - 1];
        cursor = { at: tail.at, id: tail.id };
      }
      return rows.map((row) => toEntry({ ...row, listing: null }));
    },
  };
}

/** How long the action list is kept before it is read again. */
const ACTIONS_TTL_MS = 5 * 60 * 1000;

/** @type {{ actions: Set<string>, at: number } | null} */
let actionCache = null;
/** @type {Promise<string[]> | null} */
let actionLoad = null;

/**
 * The distinct audit actions, sorted.
 * DECISION (F01-FIX-11): cached in memory for 5 minutes (one read at a time), not a fixed
 * list: actions are written from many places, some built at runtime, and old rows' actions
 * must stay filterable. The read skips through the `[action, at]` index (a loose index
 * scan), so even a miss doesn't scan the table. New actions written by this process are
 * added to a warm cache (`noteAuditAction`); one written while the list is being read, or
 * by another process, shows within 5 minutes. A rolled-back write may add an action with
 * no rows; it only offers a filter that matches nothing until the cache expires.
 * @returns {Promise<string[]>}
 */
export async function listAuditActions() {
  if (actionCache && Date.now() - actionCache.at < ACTIONS_TTL_MS)
    return [...actionCache.actions].sort();
  if (!actionLoad)
    actionLoad = (async () => {
      try {
        const rows = await prisma.$queryRaw`
          WITH RECURSIVE actions AS (
            (SELECT "action" FROM "AuditEvent" ORDER BY "action" LIMIT 1)
            UNION ALL
            SELECT (SELECT "action" FROM "AuditEvent" WHERE "action" > actions."action"
                    ORDER BY "action" LIMIT 1)
            FROM actions WHERE actions."action" IS NOT NULL
          )
          SELECT "action" FROM actions WHERE "action" IS NOT NULL`;
        actionCache = {
          actions: new Set(rows.map(({ action }) => action)),
          at: Date.now(),
        };
        return [...actionCache.actions].sort();
      } finally {
        actionLoad = null;
      }
    })();
  return actionLoad;
}

/**
 * Called by the audit writers so a new action shows in a warm cache at once.
 * @param {string} action
 */
export function noteAuditAction(action) {
  actionCache?.actions.add(action);
}

/** Tests: forget the cached action list. */
export function clearAuditActionCache() {
  actionCache = null;
  actionLoad = null;
}
