# F08-FIX-6 — Ops reads retirement failures through core

|                     |                                           |
| ------------------- | ----------------------------------------- |
| **Status**          | To do                                     |
| **Feature**         | [F08 Operations and launch](../README.md) |
| **Module(s)**       | `ops`                                     |
| **Security skills** | `security-operations`                     |

Start with `/implement-ticket F08-FIX-6` after [F01-FIX-10](../../01-foundation/tickets/F01-FIX-10.md) (`core.countAuditEntries()`, `core.listingsWithAuditEntry()`). Raised by [review 6](../../../reviews/2026-10-27-review-6.md) and carried in [review 7](../../../reviews/2026-10-27-review-7.md) (Medium).

## Problem

`ops/services/facts.js:150,168` `findPagesToRetire()` queries `AuditEvent`, which core owns, with `prisma.auditEvent.groupBy` and `findMany` (rule 00: never query another module's tables).

## Scope

- [ ] `findPagesToRetire()` first reads the candidate listing ids (closed, page still set, past the cutoff: its own `Listing` read), then counts `PageRetireFailed` in the window with `core.countAuditEntries()` and finds `PageRetireHeld` with `core.listingsWithAuditEntry()`. Same `{ due, held, newlyHeld }` result. If there are more than 500 candidates, call in chunks of 500.
- [ ] Remove the F08-FIX-1 `// DECISION:` about reading the audit log directly; `grep -n "auditEvent" app/modules/ops` returns nothing (record it in Notes).
- [ ] Update ops `CLAUDE.md`.

## Out of scope

- Any change to the hold rules (F08-FIX-4).

## Acceptance criteria

- [ ] The existing retirement tests (`ops/tests/retire-held.test.js`, `batches.test.js`) pass unchanged.
- [ ] `npm run test:ai -- app/modules/ops` is green.

## Notes
