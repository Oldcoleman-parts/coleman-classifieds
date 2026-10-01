# F07 — Operations and launch

|                     |                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| **Phase**           | 1                                                                                                    |
| **Module(s)**       | `app/modules/scheduler/`, `app/modules/ops/`                                                         |
| **Depends on**      | 02–06                                                                                                |
| **Estimate**        | ~2.5 days                                                                                            |
| **Security skills** | `security-operations` (guide coding automatically; audits run on demand with `/security-review F07`) |

## Purpose

Make every time-based rule run on its own, keep data only as long as agreed, back everything up, alert people when something breaks, and launch.

## Owns data

`OpsIncident`; purges across tables (definitions in `docs/architecture/data-model.md`)

## Events

Triggers `ListingClosed` (EXPIRED, LAPSED); publishes `IncidentRaised`.

## Routes and screens

`/jobs/run`

## Business rules

- Tasks are isolated, idempotent and time-boxed; a task failing twice → JOB incident; a watchdog alerts if there’s been no run for 3 hours or more.
- Retention: private photos 90 days after close; payment, agreement, history, messages and contact details 1 year after close (`purgeAfter`).
- Backups: Railway daily + a nightly encrypted `pg_dump` to OCP’s S3 (SSE-KMS).

## Tickets

| Ticket                      | Title                          | Status |
| --------------------------- | ------------------------------ | ------ |
| [F07-T1](tickets/F07-T1.md) | Automation and retention       | To do  |
| [F07-T2](tickets/F07-T2.md) | Backups, monitoring and launch | To do  |
