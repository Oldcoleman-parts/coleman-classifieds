# Module `platform` — part of F01 Foundation and platform

Project setup, hosting, the Shopify platform layer, the full database schema and the core listing lifecycle that every other feature uses.

- **Spec and tickets:** `docs/features/01-foundation/`
- **Security skill:** `security-platform` (loads automatically when you edit this module; audits are on demand).
- **Events:** Defines the event bus and every event in `docs/architecture/events.md`; publishes lifecycle events from `transition()`.

## Rules for this feature

- State changes only through `transition()`. Invalid transitions throw.
- The audit log is append-only (DB trigger); only the retention purge role can delete.
- Flags are read through `flags.isEnabled()`; release gates come from env (`RENEWALS_RELEASED`, `OPEN_SUBMISSIONS_RELEASED`).
- Month maths uses `addMonths` in the shop timezone. Time adjustments only go through `adjustTime()`.

## Boundaries

- Export only through `index.js`. Never import other modules’ `services/`; use their `index.js` or events.
- Status changes go through `core` `transition()`.
