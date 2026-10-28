# F03-FIX-4 — Refuse photo uploads to a closed unused invitation

|                     |                                              |
| ------------------- | -------------------------------------------- |
| **Status**          | Done                                         |
| **Feature**         | [F03 Email and photo services](../README.md) |
| **Module(s)**       | `media`                                      |
| **Security skills** | `security-media`                             |

Start with `/implement-ticket F03-FIX-4`. Follow-up from [F01-FIX-3](../../01-foundation/tickets/F01-FIX-3.md): core `closeUnusedListing()` closes the record of an INVITED listing whose invitation expired or was revoked unused. The status stays INVITED, but `closedAt`, `closedReason` (`INVITATION_EXPIRED` / `INVITATION_REVOKED`) and `purgeAfter` are set, and no `ListingClosed` event fires.

## Scope

- [x] `requireOpenListing()` in `app/modules/media/services/uploads.js` also refuses (`ConflictError`, "This listing is closed") when the listing summary's `closedAt` is set, not only when the status is in `TERMINAL_STATUSES`. `core.getListingSummary()` already returns `closedAt`.

## Out of scope

- Removing photos already uploaded to a closed INVITED listing: they go with the record in the F08-T1 retention purge.
- Any change to core or to `closeUnusedListing()`.

## Acceptance criteria

- [x] A test shows an upload to a closed INVITED listing (`closedAt` set) is refused. (`media/tests/uploads.test.js`: "SEC: rejects a closed unused invitation (INVITED with closedAt set)")
- [x] `npm run test:ai` is green for media. (100 passed, 0 failed, 1 skipped, 2026-10-19)

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Requested by F01-FIX-3 (2026-10-19).
- Done (2026-10-19): `requireOpenListing()` (`app/modules/media/services/uploads.js`) refuses when the status is final **or** `closedAt` is set. The same guard runs for the upload link, upload complete and the photo changes in `photos.js`, so a closed unused invitation takes no photo changes at any step.
- Photos already on such a listing stay until the F08-T1 retention purge (out of scope, as planned).
