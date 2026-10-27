# F01 — Foundation and platform

|                     |                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Phase**           | 1                                                                                                                                          |
| **Module(s)**       | `app/modules/platform/`, `app/modules/core/`, `app/modules/scheduler/`                                                                     |
| **Depends on**      | — (starts from the existing `shopify app init` app running on the dev store)                                                               |
| **Estimate**        | ~3 days                                                                                                                                    |
| **Security skills** | `security-core`, `security-operations`, `security-platform` (guide coding automatically; audits run on demand with `/security-review F01`) |

## Starting point (already done, don’t redo)

The app was created with `shopify app init` (React Router template, **JavaScript**). It runs with `shopify app dev` and is installed on the dev store. The template already provides:

- `app/shopify.server.js`: Shopify auth, session storage, `authenticate.admin / webhook / public.appProxy`;
- `app/db.server.js`: the Prisma client;
- `prisma/schema.prisma` with the `Session` model (SQLite by default);
- `app/routes/app.jsx`, `app/routes/app._index.jsx`: the embedded admin shell;
- `app/routes/auth.*`, `app/routes/webhooks.app.*`: auth and the default webhooks;
- `shopify.app.toml`, `shopify.web.toml`, `vite.config.js`, the `package.json` scripts.

F01 **adapts and extends** this. It never re-scaffolds.

**Hosting:** F01 delivers the repo side only (`Dockerfile`, `railway.json`, `shopify.app.staging.toml`, `docs/reference/railway-setup.md`). The Railway project, the staging app and the first CI run are deferred to [F08-T3](../08-operations-and-launch/tickets/F08-T3.md).

## Purpose

Turn the default template into the project foundation: the PostgreSQL database with the full schema, the project conventions and tooling, OCP-owned hosting, the Shopify platform layer (scopes, webhooks, app proxy) and the core listing lifecycle that every other feature uses.

## Owns data

`WebhookReceipt`, `Settings`, `Listing` (lifecycle fields), `AuditEvent`, `ListingTimeAdjustment`, plus every other table created in the initial project migration. The template’s `Session` model is kept unchanged. (Definitions are in `docs/architecture/data-model.md`.)

## Events

Defines the event bus and every event in `docs/architecture/events.md`; publishes lifecycle events from `transition()`.

## Routes and screens

`/app` (the template shell, kept), `/webhooks/*` (router, extending the template’s webhook routes), `/apps/classifieds/*` (app proxy verification), `/jobs/run`

## Business rules

- Never re-run `shopify app init` or regenerate template files. Extend `shopify.server.js`, the routes and the config instead.
- The template auth flow and `Session` model must keep working. The app must still install and open on the dev store after every change.
- State changes only through `transition()`; invalid transitions throw.
- The audit log is append-only (DB trigger); only the retention purge role can delete.
- Flags through `flags.isEnabled()`; release gates from env (`RENEWALS_RELEASED`, `OPEN_SUBMISSIONS_RELEASED`).
- Month maths with `addMonths` in the shop timezone; time adjustments only through `adjustTime()`.
- A failed `PaymentReceived` is never swallowed (F01-FIX-1): a temporary failure rejects the publish so the webhook is retried; a payment that can never be applied sets `refundFlag` and writes a `PaymentNotApplied` audit entry.
- A webhook delivery counts as handled only once its handler succeeded (F01-FIX-2): the `WebhookReceipt` gets `processedAt` then. A delivery that died mid-handler is run again on retry after one minute; while another request is working on it the answer is 500. Handlers must be idempotent.
- Public endpoints are rate-limited with `platform.rateLimit()` and `clientIp()` (F01-FIX-5): in memory, per instance, reset on deploy. A forwarded IP that isn't a plain address counts as `unknown`.
- The production server (`platform/server/start.js`, F01-FIX-7) logs the request path without the query string and with the seller token replaced by `[redacted]`. A new proxy route segment is added to its allow-list.
- Seller page support (F01-FIX-6): `SUBMIT` is refused once the draft or correction deadline has passed; `transition()` takes an optional `beforeCommit(tx, listing)` hook that runs in its transaction (workspace writes `TermsAcceptance` with it); `getChangesRequestNote()` reads the latest staff change-request note.

## Tickets

| Ticket                              | Title                                                          | Status |
| ----------------------------------- | -------------------------------------------------------------- | ------ |
| [F01-T1](tickets/F01-T1.md)         | Adapt the template: database, conventions, tooling and hosting | Done   |
| [F01-T2](tickets/F01-T2.md)         | Shopify platform layer and core lifecycle                      | Done   |
| [F01-FIX-1](tickets/F01-FIX-1.md)   | A failed payment transition must not be swallowed              | Done   |
| [F01-FIX-2](tickets/F01-FIX-2.md)   | A webhook that dies mid-handler must be retried                | Done   |
| [F01-FIX-3](tickets/F01-FIX-3.md)   | Close the record of an unused invitation                       | Done   |
| [F01-FIX-4](tickets/F01-FIX-4.md)   | Core exports for in-transaction events and the fee parser      | Done   |
| [F01-FIX-5](tickets/F01-FIX-5.md)   | Shared rate limit and client IP in platform                    | Done   |
| [F01-FIX-6](tickets/F01-FIX-6.md)   | Core support for the seller page (note, deadline, agreement)   | Done   |
| [F01-FIX-7](tickets/F01-FIX-7.md)   | The production server must not log seller links                | Done   |
| [F01-FIX-8](tickets/F01-FIX-8.md)   | Log every webhook delivery that isn't answered 200             | Done   |
| [F01-FIX-9](tickets/F01-FIX-9.md)   | core.runOutsideEvents() helper                                 | Done   |
| [F01-FIX-10](tickets/F01-FIX-10.md) | Core audit counting helpers for other modules                  | Done   |
