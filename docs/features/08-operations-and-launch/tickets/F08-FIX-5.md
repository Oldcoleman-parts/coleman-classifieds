# F08-FIX-5 — Reminder and closed-email batches skip rows already sent

|                     |                                           |
| ------------------- | ----------------------------------------- |
| **Status**          | Done                                      |
| **Feature**         | [F08 Operations and launch](../README.md) |
| **Module(s)**       | `ops`                                     |
| **Security skills** | `security-operations`                     |

Start with `/implement-ticket F08-FIX-5` after [F03-FIX-5](../../03-email-and-photos/tickets/F03-FIX-5.md) (`notifications.getEmailStatuses()`). Raised by [review 6](../../../reviews/2026-10-27-review-6.md) and carried in [review 7](../../../reviews/2026-10-27-review-7.md) (Medium).

## Problem

`ops/services/facts.js:64-68`, `reminders.js:74`, `closed-email.js:98`: the reminder and closed-email tasks page through every listing in their window, nearest deadline first, and call `send()` (closed emails also `loadListing()`) for each one, even when it was already emailed. Those rows keep matching the query, so every run spends its 45 s budget on them first. Once there are more than about 45 s of them, the later rows are never reached: the original F08-FIX-1 problem at a larger size.

## Scope

- [x] Per page, before the contacts lookup: build each listing's idempotency keys (reminders `<template>:<listingId>:<deadline ms>:<k>` for k = 0..2; closed `listing_closed:<listingId>:<closedAt ms>`), call `getEmailStatuses()` once, and leave out the listings that are already handled, with no per-listing call. Handled = a reminder with a key whose status isn't `FAILED`, or all 3 tries `FAILED`; a closed email with any row (notifications retries it itself).
- [x] The contacts lookup and the per-listing loop cover only the listings left; `due` / `checked` count those, and a `skipped` count (or `alreadySent`) reports the rest.
- [x] Keep the key format in one place per template (a small helper in `reminders.js` / `closed-email.js`) so the send and the check can't drift apart.
- [x] Correct the `listingPages` DECISION comment and ops `CLAUDE.md` (the leftover now waits an hour at most for these tasks too).

## Out of scope

- A run lock for overlapping runs (review 5 Low).

## Acceptance criteria

- [x] With 250 listings in the reminder window of which the nearest 200 were already reminded, one run with a budget that allows only a few `send()` calls reminds the later listings (test).
- [x] A listing whose reminder tries all failed is not tried again in a later run; one with a failed try and tries left is (test).
- [x] `npm run test:ai -- app/modules/ops` is green.

## Notes

- From F03-FIX-5: `getEmailStatuses(keys)` takes at most 1000 keys, so with 3 reminder keys per listing a page of 200 needs 600 (fine; don't raise the page size past 333). Finished outbox rows are removed after 30 days, so a key older than that is left out as if never sent: confirm the reminder and closed-email windows stay well under 30 days (closed backstop 7 days; reminders `draftReminderDaysBefore` / `expiryReminderDays`).
- Built: `reminderKeys(template, listingId, deadline)` in `reminders.js` and `closedEmailKey(listingId, closedAt)` in `closed-email.js` are used by both the send and the check. Per page, one `getEmailStatuses()` call runs before the contacts lookup; a page with nothing left makes no contacts or `getLinkUrl` call. The new count is `alreadySent`, not `skipped`, because deadlines already use `skipped` for "moved on" and hooks for flag-off.
- `// DECISION:` a reminder is handled when a try didn't fail (SENT, and also SUPPRESSED or DEAD), or when all 3 failed. A failed try with tries left is not handled.
- `// DECISION:` the backstop passes its page row to `sendClosedEmail(id, contacts, listing)` and skips `loadListing()`. `closedAt` and `closedReason` don't change after a close. The listener path is unchanged.
- Windows confirmed well under the outbox's 30-day purge: `draftReminderDaysBefore` and `expiryReminderDays` default to 3 and aren't staff-editable (`core/settings.js` `EDITABLE`); the closed backstop is 7 days. The `PAGE` comment in `facts.js` caps the page size at 333 (3 keys per listing, 1000 per call).
- Corrected the `listingPages` DECISION and ops `CLAUDE.md`: the leftover now waits an hour at most for every task.
- Tests: `ops/tests/already-sent.test.js` (250 listings with the nearest 200 reminded, all tries failed, a failed try retried, the closed backstop skipping sent rows, the key strings). `npm run test:ai -- app/modules/ops` → `✓ 34 passed · 0 failed`.
