// The in-process event bus. Contract: docs/architecture/events.md.
// Every event is written to AuditEvent before its handlers run. Handlers must be idempotent.
import { AsyncLocalStorage } from "node:async_hooks";
import prisma from "@/db.server";
import { requireActor, SYSTEM_ACTOR } from "./actors.js";
import { noteAuditAction } from "./audit.js";
import { ValidationError } from "./errors.js";

/** @typedef {import("./types.js").ActorRef} ActorRef */

/**
 * Payload shapes, by event name.
 * @typedef {{ invitationId: string, listingId: string }} InvitationCreated
 * @typedef {{ listingId: string, draftDueBy: Date }} DraftStarted
 * @typedef {{ listingId: string, kind: "NEW" | "CORRECTED" }} ListingSubmitted
 * @typedef {{ listingId: string, revisionId: string }} RevisionSubmitted
 * @typedef {{ listingId: string, note: string, correctionDueBy: Date }} ChangesRequested
 * @typedef {{ listingId: string, note: string | null }} ListingRejected
 * @typedef {{ listingId: string, photoIds?: string[] }} ListingApproved `photoIds` are the photos staff approved; a re-issue sends none
 * @typedef {{ listingId: string, orderGid: string, billingMode: import("./types.js").BillingMode }} PaymentReceived
 * @typedef {{ listingId: string, firstTime: boolean, expiresAt: Date }} ListingWentLive
 * @typedef {{ listingId: string, fields: string[] }} ListingUpdatedImmediate
 * @typedef {{ listingId: string, revisionId: string, photoIds: string[] }} RevisionApproved `photoIds` are the photos staff approved with the revision
 * @typedef {{ listingId: string, revisionId: string }} RevisionRejected
 * @typedef {{ listingId: string, reason: import("./types.js").PauseReason }} ListingPaused
 * @typedef {{ listingId: string, reason: import("./types.js").PauseReason, restoredMinutes: number }} ListingResumed
 * @typedef {{ listingId: string, minutes: number, reason: string }} ListingExtended
 * @typedef {{ listingId: string, overdueSince: Date }} ListingPaymentOverdue
 * @typedef {{ listingId: string, reason: "SOLD" | "REMOVED" | "EXPIRED" | "LAPSED" }} ListingClosed
 * @typedef {{ messageId: string, listingId: string, reasons: string[] }} BuyerMessageHeld
 * @typedef {{ listingId: string, chargeId: string }} RenewalResult RenewalSucceeded and RenewalFailed
 * @typedef {{ flag: string, value: boolean, staff: string }} FeatureToggled
 * @typedef {{ incidentId: string, kind: string }} IncidentRaised
 */

/**
 * What a handler receives next to the payload.
 * @typedef {{ name: string, actor: ActorRef, listingId: string | null, auditId: string }} EventMeta
 * @typedef {(payload: any, meta: EventMeta) => unknown | Promise<unknown>} EventHandler
 * @typedef {{ name: string, payload: object, meta: EventMeta }} RecordedEvent
 */

// Event name → the payload fields kept in AuditEvent.details. Anything else is dropped,
// so tokens, codes and message bodies can never reach the audit log through an event.
const AUDIT_FIELDS = {
  InvitationCreated: ["invitationId"],
  DraftStarted: ["draftDueBy"],
  ListingSubmitted: ["kind"],
  RevisionSubmitted: ["revisionId"],
  ChangesRequested: ["note", "correctionDueBy"],
  ListingRejected: ["note"],
  ListingApproved: ["photoIds"],
  PaymentReceived: ["orderGid", "billingMode"],
  ListingWentLive: ["firstTime", "expiresAt"],
  ListingUpdatedImmediate: ["fields"],
  RevisionApproved: ["revisionId", "photoIds"],
  RevisionRejected: ["revisionId"],
  ListingPaused: ["reason"],
  ListingResumed: ["reason", "restoredMinutes"],
  ListingExtended: ["minutes", "reason"],
  ListingPaymentOverdue: ["overdueSince"],
  ListingClosed: ["reason"],
  BuyerMessageHeld: ["messageId", "reasons"],
  RenewalSucceeded: ["chargeId"],
  RenewalFailed: ["chargeId"],
  FeatureToggled: ["flag", "value", "staff"],
  IncidentRaised: ["incidentId", "kind"],
};

/** Event names, e.g. `EVENTS.ListingApproved`. */
export const EVENTS = Object.freeze(
  /** @type {{ [K in keyof typeof AUDIT_FIELDS]: K }} */ (
    Object.fromEntries(Object.keys(AUDIT_FIELDS).map((name) => [name, name]))
  ),
);

// DECISION (F01-FIX-1): for these events a handler failure goes back to the publisher, so
// the payments apply step leaves appliedAt empty and its task retries. Fixed per event, not a
// `publish()` option, so a caller cannot forget it.
const MUST_SUCCEED = new Set(["PaymentReceived"]);

/** @type {Map<string, Set<EventHandler>>} */
const handlers = new Map();
// The queue of the publish that is currently running handlers, if any.
const activeQueue = new AsyncLocalStorage();

function assertKnown(name) {
  if (!Object.hasOwn(AUDIT_FIELDS, name))
    throw new ValidationError(`Unknown event ${name}`);
}

/**
 * @param {string} name an `EVENTS` name
 * @param {EventHandler} handler must be idempotent
 * @returns {() => void} unsubscribe
 */
export function subscribe(name, handler) {
  assertKnown(name);
  if (!handlers.has(name)) handlers.set(name, new Set());
  handlers.get(name).add(handler);
  return () => handlers.get(name)?.delete(handler);
}

/** Remove every subscription. Called by the app bootstrap before modules register. */
export function resetEventBus() {
  handlers.clear();
}

/**
 * Write the audit entry for an event, without running handlers. Use inside a transaction,
 * then pass the result to `dispatch()` after it commits.
 * @param {import("@prisma/client").Prisma.TransactionClient} db
 * @param {string} name
 * @param {object} payload
 * @param {{ actor?: ActorRef, listingId?: string | null, details?: object }} [options]
 *   `details` are extra audit-only fields (IDs, statuses and dates only)
 * @returns {Promise<RecordedEvent>}
 */
export async function recordEvent(db, name, payload, options = {}) {
  assertKnown(name);
  const actor = requireActor(options.actor ?? SYSTEM_ACTOR);
  const listingId = options.listingId ?? payload.listingId ?? null;
  const kept = Object.fromEntries(
    AUDIT_FIELDS[name]
      .filter((field) => payload[field] !== undefined)
      .map((field) => [field, payload[field]]),
  );
  const audit = await db.auditEvent.create({
    data: {
      listingId,
      actor: actor.type,
      actorRef: actor.ref ?? null,
      action: name,
      // Round-trip through JSON so dates are stored as ISO strings.
      details: JSON.parse(JSON.stringify({ ...kept, ...options.details })),
    },
    select: { id: true },
  });
  noteAuditAction(name);
  return { name, payload, meta: { name, actor, listingId, auditId: audit.id } };
}

/**
 * Run the handlers of a recorded event. A publish made from inside a handler is queued and
 * runs after the current event's handlers, in order. One handler failing doesn't stop the rest.
 * @param {RecordedEvent} event
 * @returns {Promise<void>}
 * @throws the first handler failure of a must-succeed event (`PaymentReceived`), after every
 *   handler and queued event has run
 */
export async function dispatch(event) {
  const running = activeQueue.getStore();
  if (running) {
    running.push(event);
    return;
  }
  /** @type {RecordedEvent[]} */
  const queue = [event];
  let failure;
  await activeQueue.run(queue, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      for (const handler of [...(handlers.get(next.name) ?? [])]) {
        try {
          await handler(next.payload, next.meta);
        } catch (error) {
          // IDs and the error type only: messages can carry personal data.
          console.error(
            `[events] a ${next.name} handler failed (audit ${next.meta.auditId}): ${error?.name}${error?.code ? ` ${error.code}` : ""}`,
          );
          if (MUST_SUCCEED.has(next.name)) failure ??= error;
        }
      }
    }
  });
  if (failure) throw failure;
}

/**
 * Run `fn` outside the event queue of the dispatch in progress, so events it publishes are
 * dispatched at once instead of being queued (or lost when it outlives that dispatch). For
 * detached work started inside a handler. A must-succeed failure inside it rejects to the
 * caller of `fn`, not to the outer dispatch.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function runOutsideEvents(fn) {
  return activeQueue.run(null, fn);
}

/**
 * Publish an event: write its audit entry, then run its handlers.
 * @param {string} name an `EVENTS` name
 * @param {object} payload the shape documented for that event
 * @param {{ actor?: ActorRef, listingId?: string | null }} [options]
 * @returns {Promise<void>}
 * @throws when a `PaymentReceived` handler failed: await it and let the rejection through
 */
export async function publish(name, payload, options = {}) {
  await dispatch(await recordEvent(prisma, name, payload, options));
}

/**
 * Write an audit entry that isn't a bus event (for example a staff action or a privacy
 * request). The caller passes IDs, statuses and dates only: never tokens, codes or messages.
 * @param {{ action: string, actor?: ActorRef, listingId?: string | null, details?: object }} entry
 * @param {{ tx?: import("@prisma/client").Prisma.TransactionClient }} [options]
 * @returns {Promise<void>}
 */
export async function writeAudit(
  { action, actor = SYSTEM_ACTOR, listingId = null, details },
  { tx } = {},
) {
  const who = requireActor(actor);
  await (tx ?? prisma).auditEvent.create({
    data: {
      listingId,
      actor: who.type,
      actorRef: who.ref ?? null,
      action,
      details: details ? JSON.parse(JSON.stringify(details)) : undefined,
    },
  });
  noteAuditAction(action);
}
