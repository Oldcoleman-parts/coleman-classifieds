# Module `console` — part of F02 Admin shell and settings and F05 Staff console

All staff screens inside Shopify admin: reviewing and managing listings, settings and features, held messages, protected history and system health.

- **Spec and tickets:** `docs/features/02-admin-shell-and-settings/` (shell, Settings, Features card) and `docs/features/05-staff-console/` (listings, messages, history, health)
- **Security skill:** `security-console` (loads automatically when you edit this module; audits are on demand).
- **Events:** Triggers approve, reject, request changes, revision decisions, pause, resume and extend through core; `FeatureToggled`.

## Rules for this feature

- Polaris only; confirmation modals for destructive actions; every action is audited with the staff email.
- Pause requires a reason (ORDINARY / INVESTIGATION); resuming an investigation asks “violation found?” and restores the time if not; extending requires days and a reason.
- History is read-only and exportable (CSV, injection-safe).
- Features card: the alerts switch is visible at launch; renewals and open submissions appear only when released.

## How it is built (F05-T1)

- `/app` is the listing list (`services/listing-list.js`: tabs with counts, search, 50 per page). `/app/listings/:id` is the review screen (`services/review.js` loads it, `services/review-actions.js` handles every intent). Status changes go through `transition()`, which audits with the staff email.
- Console sends the seller decision emails itself (`services/seller-email.js`): `changes_requested`, `listing_rejected`, `revision_rejected`, with `get_link_url` from `access.getLinkUrl()` and never a seller link. A failed email never undoes the decision.
- Photos: staff change the set only while SUBMITTED; delete until the listing closes. Approve passes the photo ids shown on the screen.
- Browser code imports `console/client.js` (badge tones, money), never `index.js`.

## How it is built (F05-T2)

- History: `services/history.js` reads `AuditEvent` read-only. The review screen shows the newest 200 entries; `/app/history/export` posts to `/app/history/export-csv`, which streams the CSV in batches of 500 ordered by `at`, then `id`. Cells go through `services/csv.js` (always quoted, formula starts neutralised). Each export writes a `HistoryExported` audit entry.
- Messages and Health are screens around other modules. Those modules register through `setMessageProvider()` and `setHealthProviders()` (`services/providers.js`); console never touches `BuyerMessage` or `OpsIncident`. Without a provider a section shows "not available yet".
- Console audits release, discard and resolve only when the provider returns `changed: true`, so a repeat is audited once.
- Health returns fixed fields, counts and dates only: never configuration, error text or an incident's `details`.

## Boundaries

- `Settings` belongs to core: save through `core.updateSettings()` and `core.setFlag()`, never with a direct query.
- Export only through `index.js`. Never import other modules’ `services/`; use their `index.js` or events.
- Status changes go through `core` `transition()`.
