# F08 — Operations and launch

|                     |                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| **Phase**           | 1                                                                                                    |
| **Module(s)**       | `app/modules/scheduler/`, `app/modules/ops/`                                                         |
| **Depends on**      | 03–07                                                                                                |
| **Estimate**        | ~2.5 days                                                                                            |
| **Security skills** | `security-operations` (guide coding automatically; audits run on demand with `/security-review F08`) |

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

| Ticket                            | Title                                                          | Status |
| --------------------------------- | -------------------------------------------------------------- | ------ |
| [F08-T1](tickets/F08-T1.md)       | Automation and retention                                       | Done   |
| [F08-T2](tickets/F08-T2.md)       | Backups, monitoring and launch                                 | To do  |
| [F08-T3](tickets/F08-T3.md)       | Hosting: GitHub CI, Railway and the staging app (do before T2) | To do  |
| [F08-T4](tickets/F08-T4.md)       | Records purge                                                  | To do  |
| [F08-T5](tickets/F08-T5.md)       | Privacy redact erasure (launch-blocking)                       | To do  |
| [F08-FIX-1](tickets/F08-FIX-1.md) | Job batches reach every due listing                            | To do  |
| [F08-FIX-2](tickets/F08-FIX-2.md) | Recovery runs don't count as the last job run                  | To do  |
| [F08-FIX-3](tickets/F08-FIX-3.md) | Ops reads seller contacts through access (after F04-FIX-4)     | Done   |
