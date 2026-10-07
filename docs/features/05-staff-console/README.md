# F05 — Staff console

|                     |                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| **Phase**           | 1                                                                                                 |
| **Module(s)**       | `app/modules/console/`                                                                            |
| **Depends on**      | 02, 04                                                                                            |
| **Estimate**        | ~3 days                                                                                           |
| **Security skills** | `security-console` (guide coding automatically; audits run on demand with `/security-review F05`) |

## Purpose

The remaining staff screens inside Shopify admin: reviewing and managing listings, held messages, protected history and system health. The admin shell, Settings and the Features card come from F02.

## Owns data

Reads most tables; time adjustments via core (definitions in `docs/architecture/data-model.md`)

## Events

Triggers approve, reject, request changes, revision decisions, pause, resume and extend through core.

## Routes and screens

`/app`, `/app/listings/:id`, `/app/messages`, `/app/history/export`, `/app/health`

## Business rules

- Polaris only; confirmation modals for destructive actions; every action is audited with the staff email.
- Pause requires a reason (ORDINARY / INVESTIGATION); resuming an investigation asks “violation found?” and restores the time if not; extending requires days and a reason.
- History is read-only and exportable (CSV, injection-safe).
- “Needs review” lists submitted listings and live listings with a change waiting. A revision on a paused listing is decided after it is resumed.
- Staff change photos (upload, order, main photo) and wording only while a listing is under review; they can delete a photo until the listing closes.
- Request changes, Reject and a declined change email the seller (sent by the console), with the “Get my link” help line instead of a link. A Reject reason is required.

## Tickets

| Ticket                      | Title                         | Status |
| --------------------------- | ----------------------------- | ------ |
| [F05-T1](tickets/F05-T1.md) | Review and listing management | Done   |
| [F05-T2](tickets/F05-T2.md) | Messages, history and health  | To do  |
