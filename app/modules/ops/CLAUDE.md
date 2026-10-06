# Module `ops` — part of F08 Operations and launch

Make every time-based rule run on its own, keep data only as long as agreed, back everything up, alert people when something breaks, and launch.

- **Spec and tickets:** `docs/features/08-operations-and-launch/`
- **Security skill:** `security-operations` (loads automatically when you edit this module; audits are on demand).
- **Events:** Triggers `ListingClosed` (EXPIRED, LAPSED); publishes `IncidentRaised`.

## Rules for this feature

- Tasks are isolated, idempotent and time-boxed; a task failing twice → JOB incident; a watchdog alerts if there’s been no run for 3 hours or more.
- Retention: private photos 90 days after close; payment, agreement, history, messages and contact details 1 year after close (`purgeAfter`).
- Backups: Railway daily + a nightly encrypted `pg_dump` to OCP’s S3 (SSE-KMS).

## Boundaries

- Export only through `index.js`. Never import other modules’ `services/`; use their `index.js` or events.
- Status changes go through `core` `transition()`.
