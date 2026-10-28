# F03-FIX-5 — notifications.getEmailStatuses(keys) for batches

|                     |                                              |
| ------------------- | -------------------------------------------- |
| **Status**          | Done                                         |
| **Feature**         | [F03 Email and photo services](../README.md) |
| **Module(s)**       | `notifications`                              |
| **Security skills** | `security-notifications`                     |

Start with `/implement-ticket F03-FIX-5`. Raised by [review 6](../../../reviews/2026-10-27-review-6.md) and carried in [review 7](../../../reviews/2026-10-27-review-7.md) (Medium, F08): ops' reminder and closed-email tasks can't tell which listings were already emailed without one `send()` or `getEmailStatus(key)` per listing, so every hourly run re-walks the rows already sent. Ops needs one batched lookup per page. Needed by [F08-FIX-5](../../08-operations-and-launch/tickets/F08-FIX-5.md).

## Scope

- [x] `getEmailStatuses(keys)` in `services/outbox.js`, exported from `index.js`: takes up to 1000 idempotency keys (each checked as `getEmailStatus()` checks one: a non-empty string of at most 200 characters; deduplicated) and returns a `Map<key, status>` with one query on `EmailOutbox.idempotencyKey`. Keys with no row are left out.
- [x] Returns the status only (`PENDING`, `SENDING`, `SENT`, `FAILED`, `DEAD`, `SUPPRESSED`): never the address, the vars or the message id. JSDoc on the export.
- [x] Update `app/modules/notifications/CLAUDE.md`.

## Out of scope

- Using it in ops ([F08-FIX-5](../../08-operations-and-launch/tickets/F08-FIX-5.md)).

## Acceptance criteria

- [x] With rows for some keys, the Map holds exactly those keys with their status, and unknown keys are left out (test).
- [x] More than 1000 keys, or an invalid key, is a `ValidationError` (test).
- [x] `npm run test:ai -- app/modules/notifications` is green.

## Notes

- `getEmailStatuses(keys)` in `services/outbox.js`, exported from `index.js`: keys deduplicated, at most 1000 after that, one `findMany` on the unique `idempotencyKey`, `select` status only; an empty list returns an empty Map without a query. A private `isValidKey()` (non-empty string, at most 200 characters, not trimmed) is shared with `getEmailStatus()`, whose behaviour is unchanged.
- `// DECISION:` an invalid key throws a `ValidationError` here, while `getEmailStatus()` returns null: a batch caller builds its keys itself, and silently leaving a bad key out would read as "never sent" and make ops send again.
- For F08-FIX-5 (added to its Notes): finished rows are removed after 30 days, so an older key is left out as if never sent; and with 3 reminder keys per listing, one call covers at most 333 listings.
- Tests: `notifications/tests/email-statuses.test.js`. `npm run test:ai -- app/modules/notifications app/modules/access` → `✓ 308 passed · 0 failed`.
