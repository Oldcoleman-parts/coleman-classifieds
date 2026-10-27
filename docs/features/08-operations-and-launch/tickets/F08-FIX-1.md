# F08-FIX-1 — Job batches reach every due listing

|                     |                                           |
| ------------------- | ----------------------------------------- |
| **Status**          | Done                                      |
| **Feature**         | [F08 Operations and launch](../README.md) |
| **Module(s)**       | `ops`                                     |
| **Security skills** | `security-operations`                     |

Start with `/implement-ticket F08-FIX-1`. Raised by [review 5](../../../reviews/2026-10-27-review-5.md) (two Mediums, F08).

## Problem

- `ops/services/facts.js:37-44` `findListings` always returns the same oldest 200 rows (`createdAt asc`, `take: 200`). Rows already reminded or emailed, or still inside their grace period, stay in that set, so once more than 200 match, newer listings are never reached by `ops.draft-reminders`, `ops.expiry-reminders`, `ops.closed-emails` or `renewals.grace-expiry` (`reminders.js:95,120`, `closed-email.js:68`, `hooks.js:24`).
- `facts.js:65-75` / `retire-pages.js:18-31`: a listing whose retirement keeps failing keeps its `metaobjectGid` and stays first in the oldest-closed batch of 20, so 20 such listings stop every other page from retiring, without notice.

## Scope

- [x] Each task's query leaves out what is already done or not yet due, so the batch holds only work for this run (for example the closed-email backstop only rows with no closed email sent, renewal grace only `overdueSince <= now - renewalGraceDays`), ordered by its deadline. If a filter can't be expressed in the query, page through with a cursor instead of always taking the first 200.
- [x] Page retirement passes over a listing that has failed N times (default 3; count from its failure audit entries or a small field, via `/schema-change` if a field is needed) and logs it by id. When F08-T2's `raiseIncident()` exists, it raises a PUBLISHING incident (add this to F08-T2's Notes).
- [x] Keep `services/facts.js` the only file that reads `Listing`.

## Out of scope

- Reading seller contacts through access ([F08-FIX-3](F08-FIX-3.md)).
- The run lock for overlapping runs (review 5 Low).

## Acceptance criteria

- [x] With 201 listings past the reminder window where the oldest 200 were already reminded, one run reminds the 201st (test).
- [x] With 20 listings whose retirement always fails and one more due, a run retires the extra one once the failing ones have reached the limit (test).
- [x] `npm run test:ai -- app/modules/ops` is green.

## Notes

- Every ops task now reads through `facts.js` `listingPages(where, field)`: pages of 200 ordered by the task's deadline, then id, until the matches run out or 45 s have passed (task box 60 s). `findListings` is gone. The deadline tasks moved too (not flagged by the review, but they used `findListings`).
- `// DECISION:` pages start after the last row's (field, id) instead of a Prisma cursor, so rows that stop matching mid-run (expired, reminded) don't break paging.
- `// DECISION:` the reminders and the closed-email backstop can't leave out "already sent" in the query (that fact lives only in notifications' outbox keys, and `getEmailStatus` takes one key), so they page through the whole window; `send()` with a used key does nothing. Renewal grace filters `overdueSince <= now - renewalGraceDays` in the query; core's guard still decides.
- `// DECISION:` no schema change. A failed retirement writes a `PageRetireFailed` audit entry (`details: { code }`, system actor) through `core.writeAudit`; `findPagesToRetire` counts them (read-only `auditEvent.groupBy` in `facts.js`, as access and console already read the audit log) and returns listings at 3 as `held`, logged by id each run. No automatic retry; F08-T2 raises a PUBLISHING incident (added to its Notes).
- Follow-up (proposed, not created): a core `countAuditEntries()` helper so only core reads `AuditEvent` (ops `facts.js`, access `invitation-email.js` / `invitations.js`, console `health.js` / `history.js`).
- Tests: `ops/tests/batches.test.js` (AC1, AC2, paging past the first page, held log has only the id). `npm run test:ai -- app/modules/ops` → `✓ 26 passed · 0 failed`.
