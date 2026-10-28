# F08-FIX-4 — Held page retirements recover, and batches keep to the time box

|                     |                                           |
| ------------------- | ----------------------------------------- |
| **Status**          | Done                                      |
| **Feature**         | [F08 Operations and launch](../README.md) |
| **Module(s)**       | `ops`                                     |
| **Security skills** | `security-operations`                     |

Start with `/implement-ticket F08-FIX-4`. Raised by [review 6](../../../reviews/2026-10-27-review-6.md) (High, plus two Mediums on the same code, F08-FIX-1).

## Problem

- `ops/services/facts.js:125-129`, `retire-pages.js:48`: a listing is held after 3 `PageRetireFailed` audit rows ever. `AuditEvent` is append-only, so nothing resets it: 3 failures during a short Shopify outage keep its public page live past photo retention for good. The task reports `errors: 0`, Health stays green, and a warning is logged every hour forever.
- `facts.js:86`: the 45 s budget is checked only between pages of 200, so a run can pass the 60 s time box.
- `facts.js:125`: the hourly `groupBy` on `AuditEvent.action` has no index (a full scan).

## Scope

- [x] Count only `PageRetireFailed` rows from the last 7 days (a constant next to `MAX_FAILURES`), so a held listing is tried again once its failures age out.
- [x] Write one `PageRetireHeld` audit entry (system actor, no details beyond `{ failures }`) when a listing is first held in a window, not every run; log held ids once per run as now. Document both actions in `docs/architecture/data-model.md`.
- [x] Report the held count so it isn't silent: keep `held` in the summary, and record in F08-T2's Notes that it raises the PUBLISHING incident (already there) and that Health shows `held > 0`.
- [x] The paging budget is checked before each listing, not only between pages (`listingPages` yields a `stopAt`, or consumers check it), for reminders, closed emails, deadlines and renewal grace.
- [x] `@@index([action, at])` on `AuditEvent` via `/schema-change` (one migration; add it to F08-T2's production migration check and the go-live checklist). This is core's table: the index change only, no core code.

## Out of scope

- Filtering already-handled rows out of the reminder and closed-email batches, and `core.countAuditEntries()` (review 6 Mediums; checklist).

## Acceptance criteria

- [x] A listing with 3 failures older than 7 days is offered for retirement again; with 3 recent failures it is held and one `PageRetireHeld` entry is written across two runs (test).
- [x] With a small budget, a task stops before the next listing once the budget has passed, inside a page (test).
- [x] `npm run test:ai -- app/modules/ops` is green.

## Notes

- Migration `20261027061902_audit_event_action_at_index`: only `CREATE INDEX "AuditEvent_action_at_idx"` (checked); the append-only triggers and purge grants are untouched. Added to F08-T2's production migration check and the go-live checklist; building it briefly blocks audit writes.
- `findPagesToRetire()` counts `PageRetireFailed` rows from the last 7 days for listings still waiting (`listing: { is: where }` in the `groupBy`, which also bounds the held list, a review 6 Low). `// DECISION:` "first held" = no `PageRetireHeld` row since the window start, so no state is stored: at most one entry per listing per window, and a held listing is retried as its failures age out (about 3 tries a week).
- `// DECISION:` held doesn't fail the task (that would raise a JOB incident); `held` stays in `JobRun.results`, and Health shows it through the PUBLISHING incident F08-T2 raises on the `PageRetireHeld` write (F08-T2 Notes updated). No console change.
- `facts.js` `startBudget()`; every ops task takes `{ now, budget }` and checks `budget.expired()` before each listing; `due` / `checked` count only handled rows. The `listingPages` comment no longer claims "an hour at most" for tasks that re-walk sent rows.
- Tests: `ops/tests/retire-held.test.js` (window, one `PageRetireHeld` over two runs, held log has only the id), `deadlines.test.js` (budget stops inside a page); shared helpers moved to `ops/tests/helpers.js`, `batches.test.js` now 121 lines. `npm run test:ai -- app/modules/ops app/modules/core app/modules/scheduler` → `✓ 281 passed · 0 failed`.
