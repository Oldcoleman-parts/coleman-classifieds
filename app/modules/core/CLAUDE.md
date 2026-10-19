# Module `core` — part of F01 Foundation and platform

Project setup, hosting, the Shopify platform layer, the full database schema and the core listing lifecycle that every other feature uses.

- **Spec and tickets:** `docs/features/01-foundation/`
- **Security skill:** `security-core` (loads automatically when you edit this module; audits are on demand).
- **Events:** Defines the event bus and every event in `docs/architecture/events.md`; publishes lifecycle events from `transition()`.

## Rules for this feature

- State changes only through `transition()`. Invalid transitions throw.
- The audit log is append-only (DB trigger); only the retention purge role can delete.
- Flags are read through `flags.isEnabled()`; release gates come from env (`RENEWALS_RELEASED`, `OPEN_SUBMISSIONS_RELEASED`).
- Month maths uses `addMonths` in the shop timezone. Time adjustments only go through `adjustTime()`.
- A handler failure is logged and swallowed, except for the events in `MUST_SUCCEED` (`events.js`, today only `PaymentReceived`): there `publish()` rejects, so the webhook is retried (F01-FIX-1).
- `payment.js` `applyPayment()` is the `PaymentReceived` listener. It throws only for a temporary failure. A payment that can never be applied sets `refundFlag` and writes a `PaymentNotApplied` audit entry; it never writes `status`.
- Other modules write an event inside their own transaction with `recordEvent(tx, …)` and call `dispatch()` after the commit (F01-FIX-4). Form money helpers `dollarsToCents()` / `centsToDollars()` are in `validators.js` (integer maths).

## Boundaries

- Export only through `index.js`. Never import other modules’ `services/`; use their `index.js` or events.
- Status changes go through `core` `transition()`.
