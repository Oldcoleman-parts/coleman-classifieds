# F05-FIX-1 — History reads through core, range and paging fixes

|                     |                                   |
| ------------------- | --------------------------------- |
| **Status**          | To do                             |
| **Feature**         | [F05 Staff console](../README.md) |
| **Module(s)**       | `console`                         |
| **Security skills** | `security-console`                |

Start with `/implement-ticket F05-FIX-1` after [F01-FIX-11](../../01-foundation/tickets/F01-FIX-11.md). Raised by [review 8](../../../reviews/2026-10-27-review-8.md) (Medium and five Lows).

## Scope

- [ ] `console/services/history.js` reads only through core's `listAuditEntries()`, the CSV reader and `listAuditActions()`; remove the direct `prisma.auditEvent` reads and the F05-T2 DECISION about them. `grep -n "auditEvent" app/modules/console --exclude-dir=tests` returns nothing.
- [ ] Paging by `(at, id)` (Previous/Next keep working) instead of an offset up to 49,950 rows.
- [ ] The 366-day check rejects a 367-day range (allow 1 hour for daylight saving).
- [ ] The export posts the resolved `from` / `to` with `period`, so it covers the days the list showed.
- [ ] `app.history.export-csv.jsx`: a session with no online user answers 403, not 500.
- [ ] Consider an allow-list of `details` keys for the CSV (record the decision).
- [ ] Update console `CLAUDE.md` and the F05 README.

## Acceptance criteria

- [ ] The existing History tests pass, plus: paging forward and back over 120 entries returns each once in order (test).
- [ ] 366 days is accepted, 367 refused (test).
- [ ] An export after midnight uses the dates the list was loaded with (test).
- [ ] The export with a session that has no online user answers 403 and writes no audit entry (test).
- [ ] `npm run test:ai -- app/modules/console` is green.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._
