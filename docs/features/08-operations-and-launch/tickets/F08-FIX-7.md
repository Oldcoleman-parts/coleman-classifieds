# F08-FIX-7 — Records purge: always audited, failures alert, one clock

|                     |                                                         |
| ------------------- | ------------------------------------------------------- |
| **Status**          | In progress                                             |
| **Feature**         | [F08 Operations and launch](../README.md)               |
| **Module(s)**       | `ops` (plus `core/purge.js`, approved with this ticket) |
| **Security skills** | `security-operations`, `security-core`                  |

Start with `/implement-ticket F08-FIX-7`. Raised by [review 8](../../../reviews/2026-10-27-review-8.md) (Medium ×3 and two Lows).

## Problem

- `ops/services/purge-records.js:100-106`: the listing-less audit purge isn't caught and `RecordsPurged` is written after it, so if it throws, listings already purged in the run are left with no audit trace.
- `purge-records.js:93-96`: a listing that fails to purge is only logged; nothing alerts, and the same listings come first every hour.
- `core/purge.js:43,95`: the queries use the app's `now`, the trigger the database's `now()`; if the app clock runs ahead, the trigger refuses a row the query picked (the whole listing-less DELETE fails).

## Scope

- [ ] Wrap the global step: a failure is logged by error code and counted (`globalFailed: true` or similar); `RecordsPurged` is always written when `listings > 0` or the global step deleted rows, after both phases.
- [ ] Make failures visible: a `PurgeFailed` audit entry (SYSTEM, listing id, error code only) per failed listing; a listing with 3 failures in 7 days is held (left out and logged by id), as `PageRetireHeld`, through core's audit helpers. F08-T2 raises the incident from it (add to F08-T2's Notes).
- [ ] `lockPurgeableListing()` and `purgeExpiredAuditEntries()` compare with the database's `now()` (UTC), not the app's `now`; tests pass a past `purgeAfter` as today.
- [ ] Low: add a `skipped` count for candidates that no longer qualify under the lock.
- [ ] Low: `purgeExpiredAuditEntries()` checks the kept rules versions as plain strings (not the id pattern).
- [ ] Update ops and core `CLAUDE.md`.

## Out of scope

- `ops.raiseIncident()` itself (F08-T2).

## Acceptance criteria

- [ ] When the global audit step throws, the run still writes one `RecordsPurged` with the listings purged, and reports the failure (test).
- [ ] A listing that fails 3 times is held and audited, and the run purges the listings after it (test).
- [ ] A row the database considers past retention is deleted even when the app's clock is behind or ahead (test with a fixed app `now` offset).
- [ ] `npm run test:ai -- app/modules/ops app/modules/core` is green.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._
