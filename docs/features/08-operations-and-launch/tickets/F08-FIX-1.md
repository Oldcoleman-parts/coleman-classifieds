# F08-FIX-1 — Job batches reach every due listing

|                     |                                           |
| ------------------- | ----------------------------------------- |
| **Status**          | To do                                     |
| **Feature**         | [F08 Operations and launch](../README.md) |
| **Module(s)**       | `ops`                                     |
| **Security skills** | `security-operations`                     |

Start with `/implement-ticket F08-FIX-1`. Raised by [review 5](../../../reviews/2026-10-27-review-5.md) (two Mediums, F08).

## Problem

- `ops/services/facts.js:37-44` `findListings` always returns the same oldest 200 rows (`createdAt asc`, `take: 200`). Rows already reminded or emailed, or still inside their grace period, stay in that set, so once more than 200 match, newer listings are never reached by `ops.draft-reminders`, `ops.expiry-reminders`, `ops.closed-emails` or `renewals.grace-expiry` (`reminders.js:95,120`, `closed-email.js:68`, `hooks.js:24`).
- `facts.js:65-75` / `retire-pages.js:18-31`: a listing whose retirement keeps failing keeps its `metaobjectGid` and stays first in the oldest-closed batch of 20, so 20 such listings stop every other page from retiring, without notice.

## Scope

- [ ] Each task's query leaves out what is already done or not yet due, so the batch holds only work for this run (for example the closed-email backstop only rows with no closed email sent, renewal grace only `overdueSince <= now - renewalGraceDays`), ordered by its deadline. If a filter can't be expressed in the query, page through with a cursor instead of always taking the first 200.
- [ ] Page retirement passes over a listing that has failed N times (default 3; count from its failure audit entries or a small field, via `/schema-change` if a field is needed) and logs it by id. When F08-T2's `raiseIncident()` exists, it raises a PUBLISHING incident (add this to F08-T2's Notes).
- [ ] Keep `services/facts.js` the only file that reads `Listing`.

## Out of scope

- Reading seller contacts through access ([F08-FIX-3](F08-FIX-3.md)).
- The run lock for overlapping runs (review 5 Low).

## Acceptance criteria

- [ ] With 201 listings past the reminder window where the oldest 200 were already reminded, one run reminds the 201st (test).
- [ ] With 20 listings whose retirement always fails and one more due, a run retires the extra one once the failing ones have reached the limit (test).
- [ ] `npm run test:ai -- app/modules/ops` is green.

## Notes
