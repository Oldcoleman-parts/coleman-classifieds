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

## Boundaries

- `Settings` belongs to core: save through `core.updateSettings()` and `core.setFlag()`, never with a direct query.
- Export only through `index.js`. Never import other modules’ `services/`; use their `index.js` or events.
- Status changes go through `core` `transition()`.
