# F08-FIX-7 — Records purge: always audited, failures alert, one clock

|                     |                                                         |
| ------------------- | ------------------------------------------------------- |
| **Status**          | Done                                                    |
| **Feature**         | [F08 Operations and launch](../README.md)               |
| **Module(s)**       | `ops` (plus `core/purge.js`, approved with this ticket) |
| **Security skills** | `security-operations`, `security-core`                  |

Start with `/implement-ticket F08-FIX-7`. Raised by [review 8](../../../reviews/2026-10-27-review-8.md) (Medium ×3 and two Lows).

## Problem

- `ops/services/purge-records.js:100-106`: the listing-less audit purge isn't caught and `RecordsPurged` is written after it, so if it throws, listings already purged in the run are left with no audit trace.
- `purge-records.js:93-96`: a listing that fails to purge is only logged; nothing alerts, and the same listings come first every hour.
- `core/purge.js:43,95`: the queries use the app's `now`, the trigger the database's `now()`; if the app clock runs ahead, the trigger refuses a row the query picked (the whole listing-less DELETE fails).

## Scope

- [x] Wrap the global step: a failure is logged by error code and counted (`globalFailed: true` or similar); `RecordsPurged` is always written when `listings > 0` or the global step deleted rows, after both phases.
- [x] Make failures visible: a `PurgeFailed` audit entry (SYSTEM, listing id, error code only) per failed listing; a listing with 3 failures in 7 days is held (left out and logged by id), as `PageRetireHeld`, through core's audit helpers. F08-T2 raises the incident from it (add to F08-T2's Notes).
- [x] `lockPurgeableListing()` and `purgeExpiredAuditEntries()` compare with the database's `now()` (UTC), not the app's `now`; tests pass a past `purgeAfter` as today.
- [x] Low: add a `skipped` count for candidates that no longer qualify under the lock.
- [x] Low: `purgeExpiredAuditEntries()` checks the kept rules versions as plain strings (not the id pattern).
- [x] Update ops and core `CLAUDE.md`.

## Out of scope

- `ops.raiseIncident()` itself (F08-T2).

## Acceptance criteria

- [x] When the global audit step throws, the run still writes one `RecordsPurged` with the listings purged, and reports the failure (test).
- [x] A listing that fails 3 times is held and audited, and the run purges the listings after it (test).
- [x] A row the database considers past retention is deleted even when the app's clock is behind or ahead (test with a fixed app `now` offset).
- [x] `npm run test:ai -- app/modules/ops app/modules/core` is green.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Built: core `purge.js` `lockPurgeableListing(tx, id)` and `purgeExpiredAuditEntries(tx, { keepRulesVersions })` compare with the database's `now() AT TIME ZONE 'UTC'` (the trigger's own expression; the `now` options are gone); kept rules versions are checked as plain strings (`requireVersionList`). Ops `facts.js`: `databaseNow()`, `PURGE_FAILED` / `PURGE_HELD`, and `heldByFailures()` pulled out of `findPagesToRetire()` (its result is unchanged; the retire tests pass as they were). `purge-records.js`: `PurgeFailed` per failed listing, held after 3 in 7 days with one `PurgeHeld` per window, `skipped`, and the global step caught (`globalFailed`).
- `// DECISION:` retention follows the database clock; `runPurgeRecords` ignores the scheduler's `now` (inside one transaction the lock and the trigger see the same instant).
- `// DECISION:` `globalFailed` is an integer (0/1), so `RecordsPurged` stays counts only; it is written whenever something was deleted or the global step failed.
- `// DECISION:` `PurgeHeld` is written once per 7-day window, as `PageRetireHeld`, so F08-T2 has one event to raise the incident from (`purge:<listingId>`, added to F08-T2's Notes). Overlapping runs could each write one: the same accepted Low as page retirement.
- No cross-module edit beyond `core/purge.js` (approved by the ticket); no migration.
- Tests: `ops/tests/purge-failures.test.js` (a failing global step still purges and writes one `RecordsPurged`; a failing listing is rolled back, audited with its code only, and the next one is purged; 3 failures hold the listing and two runs write one `PurgeHeld`, logged by id only; the app clock 2 days ahead and 40 days behind changes nothing; a plain-string rules version is kept). `purge-records.test.js` only gained the three new zero counts. `npm run test:ai -- app/modules/ops` → `✓ 65 passed · 0 failed`; `npm run test:ai -- app/modules/core` → `✓ 256 passed · 0 failed`.
