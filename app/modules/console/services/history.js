// Protected history: the timeline on the review screen, the filtered list (F05-T3) and the
// CSV export. Read-only: the audit log is append-only and nothing here changes or deletes
// an entry.
import { TZDate } from "@date-fns/tz";
import prisma from "@/db.server";
import {
  requireEmail,
  requireEnum,
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
export const PAGE_SIZE = 50;
const MAX_PAGE = 1000;
const DEFAULT_DAYS = 30;
/** Quick periods on the History screen, in days back from today. */
export const PERIODS = ["7", "30", "90", "365"];
export const ACTORS = ["STAFF", "SELLER", "BUYER", "SYSTEM"];
// Audit actions are code names: `ListingApproved`, `privacy.customers_redact`.
const ACTION_RE = /^[A-Za-z0-9._-]{1,64}$/;
export const MAX_EXPORT_DAYS = 366;
const BATCH = 500;
// The byte-order mark makes Excel read the file as UTF-8.
const BOM = String.fromCharCode(0xfeff);
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
const ORDER = [{ at: "asc" }, { id: "asc" }];

/**
 * @typedef {object} HistoryFilter every part optional; the parts present all apply
 * @property {string} [listingId]
 * @property {string} [from] `YYYY-MM-DD`, with `start` its first instant (shop timezone)
 * @property {string} [to] `YYYY-MM-DD`, with `end` the first instant after it
 * @property {string} [period] one of PERIODS when the dates came from a quick period
 * @property {Date} [start]
 * @property {Date} [end]
 * @property {string} [action]
 * @property {string} [actor] one of ACTORS
 * @property {string} [staffEmail] lower case; implies actor STAFF
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

/** A date as `YYYY-MM-DD` in the shop timezone. */
const shopDay = (date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: shopTimeZone() }).format(date);

/**
 * The "no filter" choices of the History screen's selects. DECISION (F05-T3): they send
 * a word, never an empty value, because a Polaris option with an empty value submits its
 * label ("Anyone") instead.
 */
export const ANY = "any";
export const CUSTOM_DATES = "custom";
/** The period choice for a listing's full history; only valid with a listing. */
export const ALL_DATES = "all";

const has = (value) => typeof value === "string" && value.trim() !== "";

/** A select's value, unless it is a "no filter" choice. */
const chosen = (value) =>
  has(value) && value.trim() !== ANY && value.trim() !== CUSTOM_DATES;

/**
 * Validate the history filters, shared by the list and the export so both match the same
 * entries. Every field is checked and all problems are reported in one `ValidationError`.
 * DECISION (F05-T3): no dates means the last 30 days, except with a listing, which means
 * that listing's full history (the "Export history" link on a listing).
 * DECISION (F05-T3): a staff email is an exact match, ignoring case, and implies STAFF.
 * An unknown but well-formed action simply matches nothing.
 * A quick `period` (days back from today) takes the place of the dates.
 * @param {{ listingId?: unknown, from?: unknown, to?: unknown, period?: unknown,
 *   action?: unknown, actor?: unknown, staffEmail?: unknown }} input
 * @param {{ now?: Date }} [options]
 * @returns {HistoryFilter}
 */
export function parseHistoryFilter(input, { now = new Date() } = {}) {
  /** @type {HistoryFilter} */
  const filter = {};
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

  check(() => {
    if (has(input.listingId))
      filter.listingId = requireId(input.listingId.trim(), "listingId");
  });
  check(() => {
    if (!chosen(input.action)) return;
    const action = input.action.trim();
    if (!ACTION_RE.test(action))
      throw new ValidationError("Unknown action", {
        action: "is not a known action",
      });
    filter.action = action;
  });
  check(() => {
    if (chosen(input.actor))
      filter.actor = requireEnum(input.actor.trim(), ACTORS, "actor");
  });
  check(() => {
    if (!has(input.staffEmail)) return;
    filter.staffEmail = requireEmail(input.staffEmail, "staffEmail");
    if (filter.actor && filter.actor !== "STAFF")
      throw new ValidationError("A staff email needs the Staff actor", {
        staffEmail: "only applies to staff entries",
      });
    filter.actor = "STAFF";
  });
  check(() => {
    let { from, to } = input;
    let period = chosen(input.period)
      ? requireEnum(input.period.trim(), [...PERIODS, ALL_DATES], "period")
      : undefined;
    if (period === ALL_DATES) {
      if (!filter.listingId)
        throw new ValidationError("All dates needs a listing", {
          period: "all dates needs a listing id",
        });
      return; // the listing's full history: no date bound
    }
    if (!period && !has(from) && !has(to) && !filter.listingId)
      period = String(DEFAULT_DAYS);
    if (period) {
      from = shopDay(new Date(now.getTime() - Number(period) * DAY_MS));
      to = shopDay(now);
      filter.period = period;
    } else if (!has(from) && !has(to)) return;
    // Each date is checked on its own, so a bad one isn't hidden by the other missing.
    let start;
    let end;
    check(() => {
      start = has(from) ? dayStart(from, "from") : undefined;
    });
    check(() => {
      end = has(to) ? dayStart(to, "to", 1) : undefined;
    });
    if (!has(from) || !has(to))
      throw new ValidationError("Choose both dates", {
        [has(from) ? "to" : "from"]: "is required",
      });
    if (!start || !end) return;
    if (end <= start)
      throw new ValidationError("The end date is before the start date", {
        to: "must not be before the start date",
      });
    if (end.getTime() - start.getTime() > (MAX_EXPORT_DAYS + 1) * DAY_MS)
      throw new ValidationError("The range is too long", {
        to: `the range can be at most ${MAX_EXPORT_DAYS} days`,
      });
    Object.assign(filter, { from: from.trim(), to: to.trim(), start, end });
  });

  const problems = Object.keys(fields);
  if (problems.length > 0)
    throw new ValidationError(
      problems.length === 1
        ? `Check the ${problems[0]} filter`
        : "Check the filters",
      fields,
    );
  return filter;
}

/** @param {HistoryFilter} filter */
const whereFor = (filter) => ({
  AND: [
    filter.listingId ? { listingId: filter.listingId } : {},
    filter.start ? { at: { gte: filter.start, lt: filter.end } } : {},
    filter.action ? { action: filter.action } : {},
    filter.actor ? { actor: filter.actor } : {},
    filter.staffEmail
      ? { actorRef: { equals: filter.staffEmail, mode: "insensitive" } }
      : {},
  ],
});

/** The filter as plain strings, for the form, the paging links and the export. */
const filterValues = (filter) => ({
  listingId: filter.listingId ?? "",
  // A listing without dates shows as "All dates" in the Period select.
  period: filter.period ?? (filter.listingId && !filter.from ? ALL_DATES : ""),
  from: filter.period ? "" : (filter.from ?? ""),
  to: filter.period ? "" : (filter.to ?? ""),
  action: filter.action ?? "",
  actor: filter.actor ?? "",
  staffEmail: filter.staffEmail ?? "",
});

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

/**
 * The History screen (F05-T3): the entries matching the query, newest first, a page at a
 * time. Bad filters come back as `fieldErrors` with no rows, never as an error. Rows carry
 * no `details` and show the actor's reference only for staff (their email).
 * DECISION (F05-T3): page numbers without a total count; the filters keep a result small
 * and Next is shown when one more row exists.
 * @param {Record<string, string | undefined>} query the URL search params
 * @param {{ now?: Date }} [options]
 */
export async function loadHistoryScreen(query, { now = new Date() } = {}) {
  // DECISION (F05-T3): the action list covers the whole log, not the chosen range.
  const actions = (
    await prisma.auditEvent.groupBy({
      by: ["action"],
      orderBy: { action: "asc" },
    })
  ).map(({ action }) => action);
  const base = {
    actions,
    actors: ACTORS,
    periods: PERIODS,
    maxDays: MAX_EXPORT_DAYS,
  };

  let filter;
  try {
    filter = parseHistoryFilter(query, { now });
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return {
      ...base,
      values: {
        listingId: query.listingId ?? "",
        period: query.period ?? "",
        from: query.from ?? "",
        to: query.to ?? "",
        action: query.action ?? "",
        actor: query.actor ?? "",
        staffEmail: query.staffEmail ?? "",
      },
      fieldErrors: error.fields ?? {},
      range: null,
      rows: [],
      page: 1,
      hasNext: false,
    };
  }

  const asked = Number(query.page);
  const page =
    Number.isInteger(asked) && asked >= 1 && asked <= MAX_PAGE ? asked : 1;
  const events = await prisma.auditEvent.findMany({
    where: whereFor(filter),
    orderBy: [{ at: "desc" }, { id: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE + 1,
    include: { listing: { select: { title: true } } },
  });
  const zone = shopTimeZone();
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    dateStyle: "medium",
  });
  const time = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    timeStyle: "short",
  });
  return {
    ...base,
    values: filterValues(filter),
    range: filter.from ? { from: filter.from, to: filter.to } : null,
    fieldErrors: {},
    page,
    hasNext: events.length > PAGE_SIZE,
    rows: events.slice(0, PAGE_SIZE).map((event) => ({
      id: event.id,
      at: event.at.toISOString(),
      dateLabel: date.format(event.at),
      timeLabel: time.format(event.at),
      listingId: event.listingId,
      listingTitle: event.listingId
        ? event.listing?.title || "Untitled listing"
        : null,
      action: event.action,
      actor: event.actor,
      staffEmail: event.actor === "STAFF" ? event.actorRef : null,
      summary: summarise(asObject(event.details)),
    })),
  };
}

/**
 * The history as a CSV stream: every event of the filter, oldest first, read from the
 * database a batch at a time. The export itself is audited, and that entry is not part of
 * its own file.
 * @param {HistoryFilter} filter from `parseHistoryFilter`
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
  // A listing's full history: the same file name and audit details as before F05-T3.
  // The filters used, with the actual dates of a quick period.
  const applied = Object.fromEntries(
    ["from", "to", "period", "action", "actor", "staffEmail"]
      .filter((key) => filter[key])
      .map((key) => [key, filter[key]]),
  );
  const byListing =
    Boolean(filter.listingId) && Object.keys(applied).length === 0;
  await writeAudit({
    action: "HistoryExported",
    actor: staff,
    listingId: filter.listingId ?? null,
    details: byListing ? { scope: "listing" } : applied,
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
      : filter.from
        ? `history-${filter.from}-to-${filter.to}.csv`
        : `history-listing-${filter.listingId}-filtered.csv`,
    stream,
  };
}
