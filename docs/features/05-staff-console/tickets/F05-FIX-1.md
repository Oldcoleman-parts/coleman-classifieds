# F05-FIX-1 — History reads through core, range and paging fixes

|                     |                                   |
| ------------------- | --------------------------------- |
| **Status**          | Done                              |
| **Feature**         | [F05 Staff console](../README.md) |
| **Module(s)**       | `console`                         |
| **Security skills** | `security-console`                |

Start with `/implement-ticket F05-FIX-1` after [F01-FIX-11](../../01-foundation/tickets/F01-FIX-11.md). Raised by [review 8](../../../reviews/2026-10-27-review-8.md) (Medium and five Lows).

## Scope

- [x] `console/services/history.js` reads only through core's `listAuditEntries()`, the CSV reader and `listAuditActions()`; remove the direct `prisma.auditEvent` reads and the F05-T2 DECISION about them. `grep -n "auditEvent" app/modules/console --exclude-dir=tests` returns nothing. _Met for `history.js`; `health.js` still has one count (see Notes)._
- [x] Paging by `(at, id)` (Previous/Next keep working) instead of an offset up to 49,950 rows.
- [x] The 366-day check rejects a 367-day range (allow 1 hour for daylight saving).
- [x] The export posts the resolved `from` / `to` with `period`, so it covers the days the list showed.
- [x] `app.history.export-csv.jsx`: a session with no online user answers 403, not 500.
- [x] Consider an allow-list of `details` keys for the CSV (record the decision).
- [x] Update console `CLAUDE.md` and the F05 README.

## Acceptance criteria

- [x] The existing History tests pass, plus: paging forward and back over 120 entries returns each once in order (test).
- [x] 366 days is accepted, 367 refused (test).
- [x] An export after midnight uses the dates the list was loaded with (test).
- [x] The export with a session that has no online user answers 403 and writes no audit entry (test).
- [x] `npm run test:ai -- app/modules/console` is green.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Built: `console/services/history.js` reads only through core's `listAuditEntries()`, `openAuditExport()` and `listAuditActions()` (via `toAuditFilter()`, which passes only the keys core knows); the F05-T2 DECISION about direct reads is gone. `grep -n "auditEvent" app/modules/console/services/history.js` returns nothing. **Not met for the whole module:** `services/health.js:26` still counts `EmailProblem` entries of the last 24 hours with `prisma.auditEvent.count` (the Health screen, F05-T2, outside this ticket's History scope). Follow-up: a core count helper (for example `countAuditActions({ action, since })`) and move Health onto it, or drop the count once F08-T2 gives Health the incidents and SES status. `loadHistoryScreen` pages with `after` / `before` cursors and returns `nextCursor` / `prevCursor` (no page numbers); `loadListingHistory` and `streamHistoryCsv` keep their shapes, so the review screen and the CSV route are unchanged apart from the points below. The History route's Previous / Next follow the cursors.
- `// DECISION:` the form's action check stays in console so field errors come before any query; core validates the filter again.
- `// DECISION:` the 366-day limit counts whole calendar days (both ends included), so daylight saving can't shift it (no 1-hour allowance needed).
- `// DECISION:` the export posts the list's resolved dates (`exportValues`) and is parsed with `fixedDates: true`: those dates win over the period, which stays in the audit details only when the dates are exactly that period. The GET form and paging links still let a newly chosen period win.
- `// DECISION:` no allow-list on the CSV `details` column: only the app writes details, they hold no seller contact data (checked), and an allow-list would hide new keys from staff.
- `app.history.export-csv.jsx`: a session with no online staff user answers 403 JSON before anything is parsed or audited.
- Tests: `history-list.test.js` (paging by cursor; a bad cursor shows the first page), new `history-paging.test.js` (120 entries forward and back, each once in order), new `history-range.test.js` (366 accepted, 367 refused, also across a DST change), `history-list-display.test.js` (an export after midnight uses the list's dates; the service has no direct audit reads), `history-routes.test.js` (403 and no audit entry without an online user). `tests/helpers.js` `setUp()` clears core's action cache (test-only import from `@/modules/core/audit.js`). `npm run test:ai -- app/modules/console` → `✓ 146 passed · 0 failed`.
