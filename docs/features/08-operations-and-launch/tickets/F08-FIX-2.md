# F08-FIX-2 — Recovery runs don't count as the last job run

|                     |                                           |
| ------------------- | ----------------------------------------- |
| **Status**          | To do                                     |
| **Feature**         | [F08 Operations and launch](../README.md) |
| **Module(s)**       | `scheduler`                               |
| **Security skills** | `security-operations`                     |

Start with `/implement-ticket F08-FIX-2`. Raised by [review 5](../../../reviews/2026-10-27-review-5.md) (Medium, F08): a `POST /jobs/run?task=<name>` recovery run is saved as a normal `JobRun` (`scheduler/registry.js:84`, `runs.js:15`), so `getLastRun()` reports one task's result as the last job run. Health shows it, and F08-T2's watchdog will read it.

## Scope

- [ ] Store whether a run was partial (the `only` task names, or `partial: true`) on `JobRun`, via `/schema-change` (one migration; add it to F08-T2's production migration check).
- [ ] `getLastRun()` skips partial runs; Health and the watchdog read full runs only. Partial runs are still stored and kept 30 days.
- [ ] Update `app/modules/scheduler/CLAUDE.md` and `docs/architecture/data-model.md`.

## Out of scope

- A run lock for overlapping runs (review 5 Low).

## Acceptance criteria

- [ ] After a full run and then a `?task=` run, `getLastRun()` returns the full run (test).
- [ ] `npm run test:ai -- app/modules/scheduler` is green.

## Notes
