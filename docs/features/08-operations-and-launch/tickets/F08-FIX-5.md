# F08-FIX-5 — Reminder and closed-email batches skip rows already sent

|                     |                                           |
| ------------------- | ----------------------------------------- |
| **Status**          | To do                                     |
| **Feature**         | [F08 Operations and launch](../README.md) |
| **Module(s)**       | `ops`                                     |
| **Security skills** | `security-operations`                     |

Start with `/implement-ticket F08-FIX-5` after [F03-FIX-5](../../03-email-and-photos/tickets/F03-FIX-5.md) (`notifications.getEmailStatuses()`). Raised by [review 6](../../../reviews/2026-10-27-review-6.md) and carried in [review 7](../../../reviews/2026-10-27-review-7.md) (Medium).

## Problem

`ops/services/facts.js:64-68`, `reminders.js:74`, `closed-email.js:98`: the reminder and closed-email tasks page through every listing in their window, nearest deadline first, and call `send()` (closed emails also `loadListing()`) for each one, even when it was already emailed. Those rows keep matching the query, so every run spends its 45 s budget on them first. Once there are more than about 45 s of them, the later rows are never reached: the original F08-FIX-1 problem at a larger size.

## Scope

- [ ] Per page, before the contacts lookup: build each listing's idempotency keys (reminders `<template>:<listingId>:<deadline ms>:<k>` for k = 0..2; closed `listing_closed:<listingId>:<closedAt ms>`), call `getEmailStatuses()` once, and leave out the listings that are already handled, with no per-listing call. Handled = a reminder with a key whose status isn't `FAILED`, or all 3 tries `FAILED`; a closed email with any row (notifications retries it itself).
- [ ] The contacts lookup and the per-listing loop cover only the listings left; `due` / `checked` count those, and a `skipped` count (or `alreadySent`) reports the rest.
- [ ] Keep the key format in one place per template (a small helper in `reminders.js` / `closed-email.js`) so the send and the check can't drift apart.
- [ ] Correct the `listingPages` DECISION comment and ops `CLAUDE.md` (the leftover now waits an hour at most for these tasks too).

## Out of scope

- A run lock for overlapping runs (review 5 Low).

## Acceptance criteria

- [ ] With 250 listings in the reminder window of which the nearest 200 were already reminded, one run with a budget that allows only a few `send()` calls reminds the later listings (test).
- [ ] A listing whose reminder tries all failed is not tried again in a later run; one with a failed try and tries left is (test).
- [ ] `npm run test:ai -- app/modules/ops` is green.

## Notes
