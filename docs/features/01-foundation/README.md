# F01 — Foundation and platform

|                     |                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Phase**           | 1                                                                                                                                          |
| **Module(s)**       | `app/modules/platform/`, `app/modules/core/`, `app/modules/scheduler/`                                                                     |
| **Depends on**      | —                                                                                                                                          |
| **Estimate**        | ~3 days                                                                                                                                    |
| **Security skills** | `security-core`, `security-operations`, `security-platform` (guide coding automatically; audits run on demand with `/security-review F01`) |

## Purpose

Project setup, hosting, the Shopify platform layer, the full database schema and the core listing lifecycle that every other feature uses.

## Owns data

`Session`, `WebhookReceipt`, `Settings`, `Listing` (lifecycle fields), `AuditEvent`, `ListingTimeAdjustment` — all tables created here (definitions in `docs/architecture/data-model.md`)

## Events

Defines the event bus and every event in `docs/architecture/events.md`; publishes lifecycle events from `transition()`.

## Routes and screens

`/app` (shell), `/webhooks/*` (router), `/apps/classifieds/*` (proxy verification), `/jobs/run`

## Business rules

- State changes only through `transition()`. Invalid transitions throw.
- The audit log is append-only (DB trigger); only the retention purge role can delete.
- Flags are read through `flags.isEnabled()`; release gates come from env (`RENEWALS_RELEASED`, `OPEN_SUBMISSIONS_RELEASED`).
- Month maths uses `addMonths` in the shop timezone. Time adjustments only go through `adjustTime()`.

## Tickets

| Ticket                      | Title                                              | Status |
| --------------------------- | -------------------------------------------------- | ------ |
| [F01-T1](tickets/F01-T1.md) | Project setup and Shopify platform layer           | To do  |
| [F01-T2](tickets/F01-T2.md) | Core listing lifecycle, events, flags and settings | To do  |
