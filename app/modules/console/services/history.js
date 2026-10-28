// Protected history: the timeline on the review screen and the CSV export. Read-only: the
// audit log is append-only and nothing here changes or deletes an entry.
import { TZDate } from "@date-fns/tz";
import prisma from "@/db.server";
import {
  requireId,
  requireStaff,
  shopTimeZone,
  ValidationError,
  writeAudit,
} from "@/modules/core/index.js";
import { csvRow } from "./csv.js";

// DECISION (F05-T2): console reads `AuditEvent` directly, read-only, as it already reads
// listings and payments ("Reads most tables" in the F05 README). Core has no audit reader.

export const HISTORY_COLUMNS = [
  "at",
  "listingId",
  "action",
  "actor",
  "actorRef",
  "transition",
  "from",
  "to",
  "details",
];
export const TIMELINE_LIMIT = 200;
export const MAX_EXPORT_DAYS = 366;
const BATCH = 500;
// The byte-order mark makes Excel read the file as UTF-8.
const BOM = String.fromCharCode(0xfeff);
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
const ORDER = [{ at: "asc" }, { id: "asc" }];

/**
 * @typedef {{ listingId: string } | { from: string, to: string, start: Date, end: Date }} ExportFilter
 *   `start` is the first instant of `from` and `end` the first instant after `to`, both in
 *   the shop timezone.
 */

/**
 * The first instant of a calendar day in the shop timezone.
 * @param {unknown} value `YYYY-MM-DD`
 * @param {string} field
 * @param {number} [addDays]
 */
function dayStart(value, field, addDays = 0) {
  const match = typeof value === "string" ? DATE_RE.exec(value.trim()) : null;
  const invalid = () =>
    new ValidationError(`${field} must be a date`, {
      [field]: "must be a date (YYYY-MM-DD)",
    });
  if (!match) throw invalid();
  const [year, month, day] = match.slice(1).map(Number);
  // A day that doesn't exist (Feb 30) rolls over, so check it round-trips.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day)
    throw invalid();
  return new Date(
    new TZDate(year, month - 1, day + addDays, shopTimeZone()).getTime(),
  );
}

/**
 * Validate what to export: one listing, or a date range (both dates, at most a year).
 * @param {{ listingId?: unknown, from?: unknown, to?: unknown }} input
 * @returns {ExportFilter}
 */
export function parseExportFilter({ listingId, from, to }) {
  const has = (value) => typeof value === "string" && value.trim() !== "";
  if (has(listingId)) {
    if (has(from) || has(to))
      throw new ValidationError("Choose a listing or a date range, not both", {
        listingId: "choose a listing or a date range, not both",
      });
    return { listingId: requireId(listingId.trim(), "listingId") };
  }
  if (!has(from) && !has(to))
    throw new ValidationError("Choose a listing or a date range", {
      from: "is required",
      to: "is required",
    });
  const start = dayStart(from, "from");
  const end = dayStart(to, "to", 1);
  if (end <= start)
    throw new ValidationError("The end date is before the start date", {
      to: "must not be before the start date",
    });
  if (end.getTime() - start.getTime() > (MAX_EXPORT_DAYS + 1) * DAY_MS)
    throw new ValidationError("The range is too long", {
      to: `the range can be at most ${MAX_EXPORT_DAYS} days`,
    });
  return { from: from.trim(), to: to.trim(), start, end };
}

/** @param {ExportFilter} filter */
const whereFor = (filter) =>
  "listingId" in filter
    ? { listingId: filter.listingId }
    : { at: { gte: filter.start, lt: filter.end } };

/** @param {unknown} details */
const asObject = (details) =>
  details && typeof details === "object" && !Array.isArray(details)
    ? /** @type {Record<string, unknown>} */ (details)
    : {};

/**
 * One line of the timeline: the status change, then a staff note or reason if there is one.
 * @param {Record<string, unknown>} details
 */
function summarise(details) {
  const parts = [];
  if (details.transition && details.from && details.to)
    parts.push(`${details.from} → ${details.to}`);
  for (const key of ["note", "reason"])
    if (typeof details[key] === "string" && details[key])
      parts.push(details[key]);
  return parts.join(" · ");
}

/**
 * The history of one listing, oldest first. Shows the newest entries when there are more
 * than the limit; the export has them all.
 * @param {string} listingId
 * @param {{ limit?: number }} [options]
 */
export async function loadListingHistory(
  listingId,
  { limit = TIMELINE_LIMIT } = {},
) {
  const newest = await prisma.auditEvent.findMany({
    where: { listingId },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const truncated = newest.length > limit;
  return {
    truncated,
    rows: newest
      .slice(0, limit)
      .reverse()
      .map((event) => ({
        id: event.id,
        at: event.at.toISOString(),
        actor: event.actor,
        actorRef: event.actorRef,
        action: event.action,
        summary: summarise(asObject(event.details)),
      })),
  };
}

/**
 * The CSV cells of one event. Status changes get their own columns. No seller details are
 * joined in.
 * @param {import("@prisma/client").AuditEvent} event
 */
function exportRow(event) {
  const { transition, from, to, ...rest } = asObject(event.details);
  // DECISION (F05-T2): outside a status change, `to` is an email recipient (test emails),
  // so it is left out of the export.
  const isChange = typeof transition === "string";
  return [
    event.at,
    event.listingId,
    event.action,
    event.actor,
    event.actorRef,
    isChange ? transition : "",
    isChange ? from : "",
    isChange ? to : "",
    Object.keys(rest).length > 0 ? rest : "",
  ];
}

/** Defaults for the export form: the last 30 days in the shop timezone. */
export function loadExportScreen({ now = new Date() } = {}) {
  const day = (date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: shopTimeZone() }).format(date);
  return {
    from: day(new Date(now.getTime() - 30 * DAY_MS)),
    to: day(now),
    maxDays: MAX_EXPORT_DAYS,
  };
}

/**
 * The history as a CSV stream: every event of the filter, oldest first, read from the
 * database a batch at a time. The export itself is audited, and that entry is not part of
 * its own file.
 * @param {ExportFilter} filter from `parseExportFilter`
 * @param {import("@/modules/core/types.js").ActorRef} actor the staff member, from the session
 * @returns {Promise<{ filename: string, stream: ReadableStream<Uint8Array> }>}
 */
export async function streamHistoryCsv(filter, actor) {
  const staff = requireStaff(actor);
  const where = whereFor(filter);
  // The newest event right now is where this export ends, so later entries stay out.
  const last = await prisma.auditEvent.findFirst({
    where,
    orderBy: [{ at: "desc" }, { id: "desc" }],
    select: { at: true, id: true },
  });
  const byListing = "listingId" in filter;
  await writeAudit({
    action: "HistoryExported",
    actor: staff,
    listingId: byListing ? filter.listingId : null,
    details: byListing
      ? { scope: "listing" }
      : { from: filter.from, to: filter.to },
  });

  const encoder = new TextEncoder();
  /** @type {{ at: Date, id: string } | null} */
  let cursor = null;
  let done = !last;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(BOM + csvRow(HISTORY_COLUMNS)));
      if (done) controller.close();
    },
    async pull(controller) {
      if (done) return;
      const events = await prisma.auditEvent.findMany({
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
        orderBy: ORDER,
        take: BATCH,
      });
      if (events.length > 0) {
        controller.enqueue(
          encoder.encode(
            events.map((event) => csvRow(exportRow(event))).join(""),
          ),
        );
        const tail = events[events.length - 1];
        cursor = { at: tail.at, id: tail.id };
      }
      if (events.length < BATCH) {
        done = true;
        controller.close();
      }
    },
  });

  return {
    filename: byListing
      ? `history-listing-${filter.listingId}.csv`
      : `history-${filter.from}-to-${filter.to}.csv`,
    stream,
  };
}
