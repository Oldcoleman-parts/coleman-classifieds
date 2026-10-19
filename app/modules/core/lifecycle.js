// The listing state machine. Source of truth: "Listing state machine" in
// docs/architecture/data-model.md. This is the only code that writes `listing.status`.
import prisma from "@/db.server";
import { requireActor } from "./actors.js";
import {
  ConflictError,
  ForbiddenActorError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
} from "./errors.js";
import { dispatch, EVENTS, recordEvent, writeAudit } from "./events.js";
import { flagOn } from "./flags.js";
import { getSettings } from "./settings.js";
import { addDays, addMinutes, addMonths, MINUTE_MS } from "./time.js";
import {
  optionalString,
  requireEnum,
  requireId,
  requireIdList,
  requireInt,
  requireString,
} from "./validators.js";

/** @typedef {import("./types.js").Listing} Listing */
/** @typedef {import("./types.js").ActorRef} ActorRef */

/** The events `transition()` accepts. */
export const LISTING_EVENTS = Object.freeze({
  OPEN: "OPEN",
  SUBMIT: "SUBMIT",
  REQUEST_CHANGES: "REQUEST_CHANGES",
  REJECT: "REJECT",
  APPROVE: "APPROVE",
  REISSUE: "REISSUE",
  PAY: "PAY",
  LAPSE: "LAPSE",
  APPROVE_REVISION: "APPROVE_REVISION",
  REJECT_REVISION: "REJECT_REVISION",
  PAUSE: "PAUSE",
  RESUME: "RESUME",
  EXTEND: "EXTEND",
  MARK_SOLD: "MARK_SOLD",
  REMOVE: "REMOVE",
  EXPIRE: "EXPIRE",
  RENEWAL_PAID: "RENEWAL_PAID",
  RENEWAL_FAILED: "RENEWAL_FAILED",
});

export const TERMINAL_STATUSES = Object.freeze([
  "SOLD",
  "EXPIRED",
  "REMOVED",
  "REJECTED",
  "LAPSED",
]);

const BILLING_MODES = ["ONE_MONTH", "AUTO_RENEW"];
const PAUSE_REASONS = ["ORDINARY", "INVESTIGATION"];
const NOTE_MAX = 2000;
// A technical extension is bounded so a typo can't add years to a listing.
export const MAX_EXTENSION_MINUTES = 60 * 24 * 60;

const reached = (deadline, now) => deadline !== null && deadline <= now;

/**
 * Record a time adjustment and return the new `expiresAt`.
 * @param {Ctx} ctx
 * @param {import("./types.js").AdjustmentType} type
 * @param {number} minutes
 * @param {string} reason
 * @returns {Promise<Date>}
 */
async function applyAdjustment(
  { tx, listing, actor, now },
  type,
  minutes,
  reason,
) {
  if (!listing.expiresAt)
    throw new ConflictError("The listing has no end date to adjust");
  await tx.listingTimeAdjustment.create({
    data: {
      listingId: listing.id,
      type,
      minutes,
      reason,
      staff: actor.ref,
      at: now,
    },
  });
  return addMinutes(listing.expiresAt, minutes);
}

const closeAs = (closedReason, extra = {}) => ({
  closedReason,
  publishes: EVENTS.ListingClosed,
  apply: ({ rule }) => ({ data: extra, payload: { reason: rule.to } }),
});

/**
 * The photos staff approved with a listing or a revision (may be empty). Media publishes only these.
 * @param {Ctx} ctx
 * @returns {string[]}
 */
const approvedPhotoIds = ({ payload, settings }) =>
  requireIdList(payload.photoIds, "photoIds", { max: settings.maxPhotos });

const reviseAs = (publishes, { approves = false } = {}) => ({
  from: ["LIVE"],
  to: "LIVE",
  actors: ["STAFF"],
  publishes,
  // The revision row belongs to the module that reviews it; `expiresAt` is never touched.
  apply: (ctx) => ({
    payload: {
      revisionId: requireId(ctx.payload.revisionId, "revisionId"),
      ...(approves ? { photoIds: approvedPhotoIds(ctx) } : {}),
    },
  }),
});

/**
 * @typedef {object} Ctx
 * @property {import("@prisma/client").Prisma.TransactionClient} tx
 * @property {Listing} listing the row before the change, locked for this transaction
 * @property {ActorRef} actor
 * @property {Record<string, unknown>} payload
 * @property {Date} now
 * @property {import("./types.js").Settings} settings
 * @property {Rule} rule
 *
 * @typedef {object} Rule
 * @property {string[]} from
 * @property {string} event
 * @property {string | null} to `null` keeps the current status (LIVE or PAUSED)
 * @property {string[]} actors
 * @property {string} publishes the event published after the change commits
 * @property {(ctx: Ctx) => boolean} [guard] may this happen now? (a deadline reached or not yet passed)
 * @property {string} [refusal] the message when `guard` says no (default "isn't due yet")
 * @property {import("./flags.js").FlagName} [flag] the feature that must be enabled
 * @property {string} [closedReason] stored on terminal states
 * @property {(ctx: Ctx) => { data?: object, payload?: object } | Promise<{ data?: object, payload?: object }>} apply
 */

/** @type {Rule[]} */
const RULES = [
  {
    from: ["INVITED"],
    event: "OPEN",
    to: "DRAFT",
    actors: ["SELLER"],
    publishes: EVENTS.DraftStarted,
    apply: ({ now, settings }) => {
      const draftDueBy = addDays(now, settings.draftWindowDays);
      return {
        data: { draftStartedAt: now, draftDueBy },
        payload: { draftDueBy },
      };
    },
  },
  {
    from: ["DRAFT"],
    event: "SUBMIT",
    to: "SUBMITTED",
    actors: ["SELLER"],
    publishes: EVENTS.ListingSubmitted,
    // DECISION (F01-FIX-6): refused once the draft deadline is reached (`deadline <= now`, the
    // same moment EXPIRE becomes allowed). No deadline set never blocks.
    guard: ({ listing, now }) => !reached(listing.draftDueBy, now),
    refusal: "SUBMIT isn't allowed: the deadline has passed",
    apply: () => ({ payload: { kind: "NEW" } }),
  },
  {
    from: ["DRAFT"],
    event: "EXPIRE",
    to: "EXPIRED",
    actors: ["SYSTEM"],
    guard: ({ listing, now }) => reached(listing.draftDueBy, now),
    ...closeAs("DRAFT_NOT_SUBMITTED"),
  },
  {
    from: ["SUBMITTED"],
    event: "REQUEST_CHANGES",
    to: "CHANGES_REQUESTED",
    actors: ["STAFF"],
    publishes: EVENTS.ChangesRequested,
    apply: ({ payload, now, settings }) => {
      const note = requireString(payload.note, "note", { max: NOTE_MAX });
      const correctionDueBy = addDays(now, settings.correctionWindowDays);
      return {
        data: { changesRequestedAt: now, correctionDueBy },
        payload: { note, correctionDueBy },
      };
    },
  },
  {
    from: ["CHANGES_REQUESTED"],
    event: "SUBMIT",
    to: "SUBMITTED",
    actors: ["SELLER"],
    publishes: EVENTS.ListingSubmitted,
    guard: ({ listing, now }) => !reached(listing.correctionDueBy, now),
    refusal: "SUBMIT isn't allowed: the deadline has passed",
    apply: () => ({
      data: { correctionDueBy: null },
      payload: { kind: "CORRECTED" },
    }),
  },
  {
    from: ["CHANGES_REQUESTED"],
    event: "EXPIRE",
    to: "EXPIRED",
    actors: ["SYSTEM"],
    guard: ({ listing, now }) => reached(listing.correctionDueBy, now),
    ...closeAs("CORRECTION_NOT_SUBMITTED"),
  },
  {
    from: ["SUBMITTED"],
    event: "REJECT",
    to: "REJECTED",
    actors: ["STAFF"],
    closedReason: "REJECTED",
    // DECISION: a rejection publishes ListingRejected only, not ListingClosed as well, so
    // subscribers of both (access, notifications) don't act twice.
    publishes: EVENTS.ListingRejected,
    apply: ({ payload }) => ({
      payload: {
        note: optionalString(payload.note, "note", { max: NOTE_MAX }),
      },
    }),
  },
  {
    from: ["SUBMITTED"],
    event: "APPROVE",
    to: "APPROVED_AWAITING_PAYMENT",
    actors: ["STAFF"],
    publishes: EVENTS.ListingApproved,
    // DECISION (F03-FIX-2): approval names the photos staff reviewed; only those are ever published.
    apply: (ctx) => ({
      data: {
        approvedAt: ctx.now,
        paymentDueBy: addDays(ctx.now, ctx.settings.paymentWindowDays),
      },
      payload: { photoIds: approvedPhotoIds(ctx) },
    }),
  },
  {
    // DECISION: the state table has no row for re-issuing a lapsed listing (only the note
    // "LAPSED can be re-issued by staff"). It goes back to awaiting payment with a new window.
    from: ["LAPSED"],
    event: "REISSUE",
    to: "APPROVED_AWAITING_PAYMENT",
    actors: ["STAFF"],
    publishes: EVENTS.ListingApproved,
    apply: ({ now, settings }) => ({
      data: {
        paymentDueBy: addDays(now, settings.paymentWindowDays),
        closedAt: null,
        closedReason: null,
        purgeAfter: null,
      },
    }),
  },
  {
    from: ["APPROVED_AWAITING_PAYMENT"],
    event: "PAY",
    to: "LIVE",
    actors: ["SYSTEM"],
    publishes: EVENTS.ListingWentLive,
    apply: ({ payload, now }) => {
      const billingMode = requireEnum(
        payload.billingMode,
        BILLING_MODES,
        "billingMode",
      );
      const expiresAt = addMonths(now, 1);
      return {
        data: { liveAt: now, expiresAt, billingMode },
        payload: { firstTime: true, expiresAt },
      };
    },
  },
  {
    from: ["APPROVED_AWAITING_PAYMENT"],
    event: "LAPSE",
    to: "LAPSED",
    actors: ["SYSTEM"],
    guard: ({ listing, now }) => reached(listing.paymentDueBy, now),
    ...closeAs("PAYMENT_WINDOW_PASSED"),
  },
  {
    event: "APPROVE_REVISION",
    ...reviseAs(EVENTS.RevisionApproved, { approves: true }),
  },
  // DECISION: the state table has no row for rejecting a revision; the listing stays LIVE.
  { event: "REJECT_REVISION", ...reviseAs(EVENTS.RevisionRejected) },
  {
    from: ["LIVE"],
    event: "PAUSE",
    to: "PAUSED",
    actors: ["STAFF"],
    publishes: EVENTS.ListingPaused,
    apply: ({ payload, now }) => {
      const reason = requireEnum(payload.reason, PAUSE_REASONS, "reason");
      return {
        data: { pausedAt: now, pauseReason: reason },
        payload: { reason },
      };
    },
  },
  {
    from: ["PAUSED"],
    event: "RESUME",
    to: "LIVE",
    actors: ["STAFF"],
    publishes: EVENTS.ListingResumed,
    apply: async (ctx) => {
      const { listing, payload, now } = ctx;
      const data = { pausedAt: null, pauseReason: null };
      let restoredMinutes = 0;
      if (listing.pauseReason === "INVESTIGATION") {
        // Staff must say how the investigation ended; time is restored only without a violation.
        if (typeof payload.violation !== "boolean")
          throw new ValidationError("violation must be true or false", {
            violation: "must be true or false",
          });
        // DECISION: the restore is the paused time in whole minutes, rounded down.
        const paused = Math.floor((now - listing.pausedAt) / MINUTE_MS);
        if (!payload.violation && paused > 0) {
          restoredMinutes = paused;
          data.expiresAt = await applyAdjustment(
            ctx,
            "INVESTIGATION_RESTORE",
            paused,
            "Investigation closed with no violation",
          );
        }
      }
      return {
        data,
        payload: { reason: listing.pauseReason, restoredMinutes },
      };
    },
  },
  {
    from: ["LIVE", "PAUSED"],
    event: "EXTEND",
    to: null,
    actors: ["STAFF"],
    publishes: EVENTS.ListingExtended,
    apply: async (ctx) => {
      const minutes = requireInt(ctx.payload.minutes, "minutes", {
        min: 1,
        max: MAX_EXTENSION_MINUTES,
      });
      const reason = requireString(ctx.payload.reason, "reason", { max: 500 });
      const expiresAt = await applyAdjustment(
        ctx,
        "TECHNICAL_EXTENSION",
        minutes,
        reason,
      );
      return { data: { expiresAt }, payload: { minutes, reason } };
    },
  },
  {
    // DECISION: "sold / removed — SELLER / STAFF" is read as: either actor may do either.
    from: ["LIVE", "PAUSED"],
    event: "MARK_SOLD",
    to: "SOLD",
    actors: ["SELLER", "STAFF"],
    ...closeAs("SOLD", { renewalOn: false }),
  },
  {
    from: ["LIVE", "PAUSED"],
    event: "REMOVE",
    to: "REMOVED",
    actors: ["SELLER", "STAFF"],
    ...closeAs("REMOVED", { renewalOn: false }),
  },
  {
    // A paused listing doesn't expire (no row in the table): it expires on the first job
    // run after it is resumed, if its end date has passed by then.
    from: ["LIVE"],
    event: "EXPIRE",
    to: "EXPIRED",
    actors: ["SYSTEM"],
    guard: ({ listing, now }) =>
      reached(listing.expiresAt, now) && !listing.renewalOn,
    ...closeAs("MONTH_ENDED"),
  },
  {
    from: ["LIVE"],
    event: "RENEWAL_PAID",
    to: "LIVE",
    actors: ["SYSTEM"],
    flag: "renewals",
    publishes: EVENTS.ListingWentLive,
    apply: ({ listing }) => {
      const expiresAt = addMonths(listing.expiresAt, 1);
      return { data: { expiresAt }, payload: { firstTime: false, expiresAt } };
    },
  },
  {
    from: ["LIVE"],
    event: "RENEWAL_FAILED",
    to: "PAYMENT_OVERDUE",
    actors: ["SYSTEM"],
    flag: "renewals",
    publishes: EVENTS.ListingPaymentOverdue,
    apply: ({ now }) => ({
      data: { overdueSince: now },
      payload: { overdueSince: now },
    }),
  },
  {
    from: ["PAYMENT_OVERDUE"],
    event: "PAY",
    to: "LIVE",
    actors: ["SYSTEM"],
    publishes: EVENTS.ListingWentLive,
    apply: ({ now }) => {
      const expiresAt = addMonths(now, 1);
      return {
        data: { liveAt: now, expiresAt, overdueSince: null },
        payload: { firstTime: false, expiresAt },
      };
    },
  },
  {
    from: ["PAYMENT_OVERDUE"],
    event: "EXPIRE",
    to: "EXPIRED",
    actors: ["SYSTEM"],
    guard: ({ listing, now, settings }) =>
      listing.overdueSince !== null &&
      reached(addDays(listing.overdueSince, settings.renewalGraceDays), now),
    ...closeAs("RENEWAL_NOT_PAID", { renewalOn: false }),
  },
];

/** @type {Map<string, Rule>} */
const RULE_BY_KEY = new Map(
  RULES.flatMap((rule) =>
    rule.from.map((from) => [`${from}:${rule.event}`, rule]),
  ),
);

/**
 * Whether the state table has this move for this actor. It doesn't check deadlines, flags
 * or the payload; `transition()` does.
 * @param {Pick<Listing, "status">} listing
 * @param {string} event a `LISTING_EVENTS` name
 * @param {ActorRef} actor
 * @returns {boolean}
 */
export function canTransition(listing, event, actor) {
  const rule = RULE_BY_KEY.get(`${listing.status}:${event}`);
  return Boolean(rule && rule.actors.includes(actor?.type));
}

/**
 * Apply a lifecycle event to a listing. The status change, its deadline fields and the audit
 * entry are written in one transaction; the event's handlers run after it commits.
 * @param {string} listingId
 * @param {string} event a `LISTING_EVENTS` name
 * @param {ActorRef} actor STAFF needs `ref` (the staff email from the session)
 * @param {Record<string, unknown>} [payload] what the event needs, e.g. `{ note }`,
 *   `{ billingMode }`, `{ reason }`, `{ violation }`, `{ minutes, reason }`, `{ revisionId }`
 * @param {{ now?: Date, beforeCommit?: (tx: object, listing: Listing) => unknown }} [options]
 *   `beforeCommit` runs inside the transaction after the change and its audit entry are
 *   written; whatever it throws rolls everything back (and no event is sent)
 * @returns {Promise<Listing>} the listing after the change
 * @throws {InvalidTransitionError | ForbiddenActorError | NotFoundError | ValidationError}
 */
export async function transition(
  listingId,
  event,
  actor,
  payload = {},
  { now = new Date(), beforeCommit } = {},
) {
  requireId(listingId, "listingId");
  const who = requireActor(actor);
  if (beforeCommit !== undefined && typeof beforeCommit !== "function")
    throw new ValidationError("beforeCommit must be a function", {
      beforeCommit: "must be a function",
    });

  const { listing, recorded } = await prisma.$transaction(async (tx) => {
    // Lock the row, so two events for one listing are applied one after the other.
    await tx.$queryRaw`SELECT id FROM "Listing" WHERE id = ${listingId} FOR UPDATE`;
    const current = await tx.listing.findUnique({ where: { id: listingId } });
    if (!current) throw new NotFoundError("Listing not found");
    // DECISION (F01-FIX-3): a closed INVITED record (unused invitation) can't move on.
    if (current.status === "INVITED" && current.closedAt)
      throw new InvalidTransitionError(
        `${event} isn't allowed: this invitation was closed unused`,
      );

    const rule = RULE_BY_KEY.get(`${current.status}:${event}`);
    if (!rule)
      throw new InvalidTransitionError(
        `${event} isn't allowed while the listing is ${current.status}`,
      );
    if (!rule.actors.includes(who.type))
      throw new ForbiddenActorError(`${who.type} can't ${event} a listing`);

    const settings = await getSettings({ tx });
    const ctx = {
      tx,
      listing: current,
      actor: who,
      payload,
      now,
      settings,
      rule,
    };
    if (rule.flag && !flagOn(settings, rule.flag))
      throw new InvalidTransitionError(`${event} needs a feature that is off`);
    if (rule.guard && !rule.guard(ctx))
      throw new InvalidTransitionError(
        rule.refusal ?? `${event} isn't due yet`,
      );

    const to = rule.to ?? current.status;
    const effect = await rule.apply({ ...ctx, rule: { ...rule, to } });
    const data = { ...effect.data, status: to };
    if (TERMINAL_STATUSES.includes(to)) {
      data.closedAt = now;
      data.closedReason = rule.closedReason;
      data.purgeAfter = addDays(now, settings.recordsRetentionDays);
    }

    const updated = await tx.listing.update({ where: { id: listingId }, data });
    const recorded = await recordEvent(
      tx,
      rule.publishes,
      { listingId, ...effect.payload },
      {
        actor: who,
        listingId,
        details: { transition: event, from: current.status, to },
      },
    );
    // DECISION (F01-FIX-6): the hook sees the changed listing and runs only once every check
    // passed; it lets a caller write its own row in the same transaction (e.g. TermsAcceptance).
    if (beforeCommit) await beforeCommit(tx, updated);
    return { listing: updated, recorded };
  });

  await dispatch(recorded);
  return listing;
}

/**
 * Why an unused INVITED listing was closed, and the one actor type allowed for each.
 * @type {Readonly<Record<"INVITATION_EXPIRED" | "INVITATION_REVOKED", ActorRef["type"]>>}
 */
export const UNUSED_CLOSE_REASONS = Object.freeze({
  INVITATION_EXPIRED: "SYSTEM",
  INVITATION_REVOKED: "STAFF",
});

const UNUSED_CLOSE_ACTIONS = Object.freeze({
  INVITATION_EXPIRED: "InvitationExpired",
  INVITATION_REVOKED: "InvitationRevoked",
});

/**
 * Close the record of an INVITED listing whose invitation expired or was revoked unused:
 * `closedAt`, `closedReason` and `purgeAfter`, with one audit entry. Safe to repeat.
 * DECISION (F01-FIX-3): no status change, so no ListingClosed fires and nothing downstream
 * reacts (no seller email, no discount clean-up); closedAt and purgeAfter feed the media
 * retention and the F08 purge. This audit entry is the only one; access writes none.
 * @param {string} listingId
 * @param {keyof typeof UNUSED_CLOSE_REASONS} reason
 * @param {ActorRef} actor SYSTEM for INVITATION_EXPIRED, STAFF (with ref) for INVITATION_REVOKED
 * @param {{ tx?: import("@prisma/client").Prisma.TransactionClient, now?: Date }} [options]
 *   pass the caller's `tx` so the invitation and the listing close together
 * @returns {Promise<{ listing: Listing, closed: boolean }>} `closed` is false when it already was
 * @throws {InvalidTransitionError | ForbiddenActorError | NotFoundError | ValidationError}
 */
export async function closeUnusedListing(
  listingId,
  reason,
  actor,
  { tx, now = new Date() } = {},
) {
  requireId(listingId, "listingId");
  const who = requireActor(actor);
  requireEnum(reason, Object.keys(UNUSED_CLOSE_REASONS), "reason");
  if (UNUSED_CLOSE_REASONS[reason] !== who.type)
    throw new ForbiddenActorError(
      `${who.type} can't close a listing as ${reason}`,
    );

  const run = async (db) => {
    await db.$queryRaw`SELECT id FROM "Listing" WHERE id = ${listingId} FOR UPDATE`;
    const current = await db.listing.findUnique({ where: { id: listingId } });
    if (!current) throw new NotFoundError("Listing not found");
    if (current.status !== "INVITED")
      throw new InvalidTransitionError(
        `${reason} isn't allowed while the listing is ${current.status}`,
      );
    if (current.closedAt) return { listing: current, closed: false };

    const settings = await getSettings({ tx: db });
    const listing = await db.listing.update({
      where: { id: listingId },
      data: {
        closedAt: now,
        closedReason: reason,
        purgeAfter: addDays(now, settings.recordsRetentionDays),
      },
    });
    await writeAudit(
      {
        action: UNUSED_CLOSE_ACTIONS[reason],
        actor: who,
        listingId,
        details: {
          invitationId: current.invitationId,
          closedReason: reason,
          status: "INVITED",
        },
      },
      { tx: db },
    );
    return { listing, closed: true };
  };
  return tx ? run(tx) : prisma.$transaction(run);
}

/**
 * Add time to a live or paused listing (a technical extension). Staff only, with a reason,
 * and at most 60 days at a time. Investigation restores happen through the RESUME event.
 * @param {string} listingId
 * @param {{ minutes: number, reason: string }} adjustment
 * @param {ActorRef} actor
 * @param {{ now?: Date }} [options]
 * @returns {Promise<Listing>}
 */
export function adjustTime(
  listingId,
  { minutes, reason } = {},
  actor,
  options,
) {
  return transition(
    listingId,
    LISTING_EVENTS.EXTEND,
    actor,
    { minutes, reason },
    options,
  );
}
