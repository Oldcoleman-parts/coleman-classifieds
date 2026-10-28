# F08-FIX-2 — Recovery runs don't count as the last job run

|                     |                                           |
| ------------------- | ----------------------------------------- |
| **Status**          | Done                                      |
| **Feature**         | [F08 Operations and launch](../README.md) |
| **Module(s)**       | `scheduler`                               |
| **Security skills** | `security-operations`                     |

Start with `/implement-ticket F08-FIX-2`. Raised by [review 5](../../../reviews/2026-10-27-review-5.md) (Medium, F08): a `POST /jobs/run?task=<name>` recovery run is saved as a normal `JobRun` (`scheduler/registry.js:84`, `runs.js:15`), so `getLastRun()` reports one task's result as the last job run. Health shows it, and F08-T2's watchdog will read it.

## Scope

- [x] Store whether a run was partial (the `only` task names, or `partial: true`) on `JobRun`, via `/schema-change` (one migration; add it to F08-T2's production migration check).
- [x] `getLastRun()` skips partial runs; Health and the watchdog read full runs only. Partial runs are still stored and kept 30 days.
- [x] Update `app/modules/scheduler/CLAUDE.md` and `docs/architecture/data-model.md`.

## Out of scope

- A run lock for overlapping runs (review 5 Low).

## Acceptance criteria

- [x] After a full run and then a `?task=` run, `getLastRun()` returns the full run (test).
- [x] `npm run test:ai -- app/modules/scheduler` is green.

## Notes

- Migration `20261027053942_add_job_run_partial`: `JobRun.partial Boolean @default(false)`; existing rows count as full runs. No index change (about 720 rows; retention filters on `finishedAt`). Added to F08-T2's production migration check and `docs/reference/go-live-checklist.md`.
- `// DECISION:` a boolean, not the `only` names: which tasks ran is already in `results[].task`. `runTasks` sets `partial: Array.isArray(only)`; `getLastRun()` filters `partial: false`. Health and the F08-T2 watchdog read it with no console change; Health doesn't show recovery runs (default, would need console).
- Tests: `scheduler/tests/job-runs.test.js` (the AC, and a run without `?task=` stored as full). `npm run test:ai -- app/modules/scheduler app/modules/console app/modules/ops` → `✓ 151 passed · 0 failed`.
