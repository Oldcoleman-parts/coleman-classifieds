// Public API of the core module. Other modules import only from here.
// Shared shapes are in ./types.js and event payloads in ./events.js (JSDoc only).
import { SYSTEM_ACTOR } from "./actors.js";
import { EVENTS, subscribe } from "./events.js";
import { isReleased } from "./flags.js";
import { LISTING_EVENTS, transition } from "./lifecycle.js";
import { applyPayment } from "./payment.js";

export {
  requireActor,
  requireStaff,
  staffFromSession,
  SYSTEM_ACTOR,
} from "./actors.js";
export { countAuditEntries, listingsWithAuditEntry } from "./audit.js";
export {
  AppError,
  ConflictError,
  ForbiddenActorError,
  InvalidTransitionError,
  NotFoundError,
  ShopifyUserError,
  UnauthorizedError,
  ValidationError,
} from "./errors.js";
export {
  dispatch,
  EVENTS,
  publish,
  recordEvent,
  resetEventBus,
  runOutsideEvents,
  subscribe,
  writeAudit,
} from "./events.js";
export { isEnabled, isReleased, setFlag } from "./flags.js";
export {
  adjustTime,
  canTransition,
  closeUnusedListing,
  LISTING_EVENTS,
  MAX_EXTENSION_MINUTES,
  TERMINAL_STATUSES,
  transition,
  UNUSED_CLOSE_REASONS,
} from "./lifecycle.js";
export { getChangesRequestNote, getListingSummary } from "./listings.js";
export { getSettings, updateSettings } from "./settings.js";
export { addMonths, shopTimeZone } from "./time.js";
export {
  centsToDollars,
  dollarsToCents,
  optionalString,
  readForm,
  requireCents,
  requireEmail,
  requireEnum,
  requireId,
  requireIdList,
  requireInt,
  requireString,
} from "./validators.js";

/**
 * Called from the app bootstrap. Core reacts to payment events by moving the listing on.
 * A failed payment is never swallowed: see `applyPayment()` (F01-FIX-1).
 */
export function register() {
  subscribe(EVENTS.PaymentReceived, (payload) => applyPayment(payload));

  // Phase 2: no listeners until renewals are released; `transition()` also checks the flag.
  if (isReleased("renewals")) {
    subscribe(EVENTS.RenewalSucceeded, ({ listingId }) =>
      transition(listingId, LISTING_EVENTS.RENEWAL_PAID, SYSTEM_ACTOR),
    );
    subscribe(EVENTS.RenewalFailed, ({ listingId }) =>
      transition(listingId, LISTING_EVENTS.RENEWAL_FAILED, SYSTEM_ACTOR),
    );
  }
}
