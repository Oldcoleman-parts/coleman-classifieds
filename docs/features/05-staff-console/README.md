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

`/app`, `/app/listings/:id`, `/app/messages`, `/app/history` (the list with filters, F05-T3), `/app/history/export` (redirects to `/app/history`) and `/app/history/export-csv` (the file, POST only), `/app/health`

## Business rules

- Polaris only; confirmation modals for destructive actions; every action is audited with the staff email.
- Pause requires a reason (ORDINARY / INVESTIGATION); resuming an investigation asks “violation found?” and restores the time if not; extending requires days and a reason.
- History is read-only and exportable (CSV, injection-safe). The History screen lists entries newest first, 50 a page, filtered by a quick period (last 7, 30, 90 days or 12 months; default 30 days) or custom dates (at most 366 days), listing, action, actor and staff email; the export contains exactly the filtered entries. A listing without dates means its full history.
- “Needs review” lists submitted listings and live listings with a change waiting. A revision on a paused listing is decided after it is resumed.
- Staff change photos (upload, order, main photo) and wording only while a listing is under review; they can delete a photo until the listing closes.
- Request changes, Reject and a declined change email the seller (sent by the console), with the “Get my link” help line instead of a link. A Reject reason is required.

## Tickets

| Ticket                            | Title                                                                 | Status |
| --------------------------------- | --------------------------------------------------------------------- | ------ |
| [F05-T1](tickets/F05-T1.md)       | Review and listing management                                         | Done   |
| [F05-T2](tickets/F05-T2.md)       | Messages, history and health                                          | Done   |
| [F05-T3](tickets/F05-T3.md)       | History list with filters                                             | Done   |
| [F05-FIX-1](tickets/F05-FIX-1.md) | History reads through core, range and paging fixes (after F01-FIX-11) | To do  |
| [F05-FIX-2](tickets/F05-FIX-2.md) | Refuse re-issuing a lapsed listing of an erased seller                | To do  |
