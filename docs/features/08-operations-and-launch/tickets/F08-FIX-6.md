# F08-FIX-6 — Ops reads retirement failures through core

|                     |                                           |
| ------------------- | ----------------------------------------- |
| **Status**          | Done                                      |
| **Feature**         | [F08 Operations and launch](../README.md) |
| **Module(s)**       | `ops`                                     |
| **Security skills** | `security-operations`                     |

Start with `/implement-ticket F08-FIX-6` after [F01-FIX-10](../../01-foundation/tickets/F01-FIX-10.md) (`core.countAuditEntries()`, `core.listingsWithAuditEntry()`). Raised by [review 6](../../../reviews/2026-10-27-review-6.md) and carried in [review 7](../../../reviews/2026-10-27-review-7.md) (Medium).

## Problem

`ops/services/facts.js:150,168` `findPagesToRetire()` queries `AuditEvent`, which core owns, with `prisma.auditEvent.groupBy` and `findMany` (rule 00: never query another module's tables).

## Scope

- [x] `findPagesToRetire()` first reads the candidate listing ids (closed, page still set, past the cutoff: its own `Listing` read), then counts `PageRetireFailed` in the window with `core.countAuditEntries()` and finds `PageRetireHeld` with `core.listingsWithAuditEntry()`. Same `{ due, held, newlyHeld }` result. If there are more than 500 candidates, call in chunks of 500.
- [x] Remove the F08-FIX-1 `// DECISION:` about reading the audit log directly; `grep -n "auditEvent" app/modules/ops` returns nothing (record it in Notes).
- [x] Update ops `CLAUDE.md`.

## Out of scope

- Any change to the hold rules (F08-FIX-4).

## Acceptance criteria

- [x] The existing retirement tests (`ops/tests/retire-held.test.js`, `batches.test.js`) pass unchanged.
- [x] `npm run test:ai -- app/modules/ops` is green.

## Notes

- Built: `findPagesToRetire()` reads the candidate ids itself (same filter, oldest close first, then id), counts `PageRetireFailed` with `core.countAuditEntries()` and finds `PageRetireHeld` with `core.listingsWithAuditEntry()`, 500 ids a call (`AUDIT_CHUNK`); `held` (count `>= maxFailures`) is worked out in JS. Same `{ due, held, newlyHeld }` result; `retire-pages.js` is unchanged.
- `// DECISION:` every candidate id is read (ids only, no cap): hourly retirement of 20 keeps the backlog small, and a cap would hide held listings past it and make `held` / `newlyHeld` wrong. Queries: 1 + ceil(candidates / 500), plus ceil(held / 500) when something is held.
- The F08-FIX-1 DECISION about reading the audit log directly is removed. `grep -rn "auditEvent" app/modules/ops --exclude-dir=tests` returns nothing. The tests still seed and check audit rows with `prisma.auditEvent` (`tests/helpers.js`, `retire-held.test.js`, `batches.test.js`): fixtures, left as they are because the AC keeps those tests unchanged.
- Tests: `ops/tests/retire-chunks.test.js` (501 candidates; the listing at position 501, in the second chunk, with 3 failures is held and newly held with `failures: 3`, not due; `due` has `take` entries oldest close first). It calls `resetDb()` in `afterAll` because audit rows are append-only. `retire-held.test.js` and `batches.test.js` unchanged. `npm run test:ai -- app/modules/ops` → `✓ 37 passed · 0 failed`.
