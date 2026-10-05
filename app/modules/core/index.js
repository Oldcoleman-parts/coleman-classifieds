// Public API of the core module. Other modules import only from here.
// Shared shapes are in ./types.js and event payloads in ./events.js (JSDoc only).
import { SYSTEM_ACTOR } from "./actors.js";
import { EVENTS, subscribe } from "./events.js";
import { isReleased } from "./flags.js";
import { LISTING_EVENTS, transition } from "./lifecycle.js";

export { requireActor, requireStaff, SYSTEM_ACTOR } from "./actors.js";
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
  EVENTS,
  publish,
  resetEventBus,
  subscribe,
  writeAudit,
} from "./events.js";
export { isEnabled, isReleased, setFlag } from "./flags.js";
export {
  adjustTime,
  canTransition,
  LISTING_EVENTS,
  MAX_EXTENSION_MINUTES,
  TERMINAL_STATUSES,
  transition,
} from "./lifecycle.js";
export { getSettings } from "./settings.js";
export { addMonths, shopTimeZone } from "./time.js";
export {
  optionalString,
  readForm,
  requireCents,
  requireEmail,
  requireEnum,
  requireId,
  requireInt,
  requireString,
} from "./validators.js";

/**
 * Called from the app bootstrap. Core reacts to payment events by moving the listing on.
 * A repeated event finds the listing already moved and is rejected by `transition()`.
 */
export function register() {
  subscribe(EVENTS.PaymentReceived, ({ listingId, billingMode }) =>
    transition(listingId, LISTING_EVENTS.PAY, SYSTEM_ACTOR, { billingMode }),
  );

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
