# F04 — Staff console

|                     |                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| **Phase**           | 1                                                                                                 |
| **Module(s)**       | `app/modules/console/`                                                                            |
| **Depends on**      | 01, 03                                                                                            |
| **Estimate**        | ~3.5 days                                                                                         |
| **Security skills** | `security-console` (guide coding automatically; audits run on demand with `/security-review F04`) |

## Purpose

All staff screens inside Shopify admin: reviewing and managing listings, settings and features, held messages, protected history and system health.

## Owns data

Reads most tables; writes `Settings`; time adjustments via core (definitions in `docs/architecture/data-model.md`)

## Events

Triggers approve, reject, request changes, revision decisions, pause, resume and extend through core; `FeatureToggled`.

## Routes and screens

`/app`, `/app/listings/:id`, `/app/messages`, `/app/settings`, `/app/settings/features`, `/app/history/export`, `/app/health`

## Business rules

- Polaris only; confirmation modals for destructive actions; every action is audited with the staff email.
- Pause requires a reason (ORDINARY / INVESTIGATION); resuming an investigation asks “violation found?” and restores the time if not; extending requires days and a reason.
- History is read-only and exportable (CSV, injection-safe).
- Features card: the alerts switch is visible at launch; renewals and open submissions appear only when released.

## Tickets

| Ticket                      | Title                         | Status |
| --------------------------- | ----------------------------- | ------ |
| [F04-T1](tickets/F04-T1.md) | Review and listing management | To do  |
| [F04-T2](tickets/F04-T2.md) | Settings, history and health  | To do  |
