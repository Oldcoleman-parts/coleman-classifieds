# F01-FIX-3 — Close the record of an unused invitation

|                     |                                             |
| ------------------- | ------------------------------------------- |
| **Status**          | Done                                        |
| **Feature**         | [F01 Foundation and platform](../README.md) |
| **Module(s)**       | `core`, `access` (callers)                  |
| **Security skills** | `security-core`, `security-access`          |

Start with `/implement-ticket F01-FIX-3`. Follow-up from [F04-T1](../../04-seller-journey/tickets/F04-T1.md) (Notes: an expired or revoked invitation’s INVITED listing is left as it is).

## Scope

- [x] A core way to close the record of an unused INVITED listing whose invitation expired or was revoked: set `closedAt`, `closedReason` and `purgeAfter = closedAt + recordsRetentionDays`, so the retention purge (F08) removes it and its staff photos.
- [x] Decide whether this is a state-machine row (INVITED → a terminal state, with its event and actor) or a core helper. Either way it goes through `core/lifecycle` (row lock, audit entry), never a direct write.
- [x] New `closedReason` values `INVITATION_EXPIRED` and `INVITATION_REVOKED`, documented in `docs/architecture/data-model.md` (the `closedReason` list, the state machine table and the “Not status changes” line), plus any new event in `docs/architecture/events.md`.
- [x] Access calls it from `revokeInvitation()` and `runExpiry()`.

## Out of scope

- The retention purge itself (F08).
- Closing a listing that has left INVITED (staff reject or remove it, F05).

## Acceptance criteria

- [x] Revoking an unused invitation, or letting it expire, leaves the listing closed with the matching `closedReason` and a `purgeAfter`, and writes one audit entry.
- [x] A listing that is no longer INVITED is refused; a repeat call (job re-run) changes nothing.
- [x] `npm run test:ai` is green for this feature and for `access`.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Requested by F04-T1 (2026-10-06). See also the F01-T2 follow-up “decide what happens to a listing whose invitation expires unused”.
- If a new terminal state is added, check that media’s closed-listing handling and the F08 purge treat it like the other terminal states.
- **Built (2026-10-19):** core `closeUnusedListing(listingId, reason, actor, { tx, now })` in `lifecycle.js`, exported with `UNUSED_CLOSE_REASONS`. Access calls it inside the transaction of `revokeInvitation()` (STAFF) and `runExpiry()` (SYSTEM).
- DECISION: a core helper, not a state row. The listing stays INVITED, so no `ListingClosed` fires (it would make notifications, payments and the others react to a listing that never started) and the console "All" list is unchanged. No schema change.
- DECISION: the helper writes the single `InvitationExpired` / `InvitationRevoked` audit entry (details: `invitationId`, `closedReason`, `status`); access no longer writes its own.
- DECISION: each reason has one allowed actor type (EXPIRED = SYSTEM, REVOKED = STAFF). `transition()` refuses any event on a closed INVITED record.
- DECISION: `runExpiry()` runs one transaction per invitation; a failure (e.g. the seller opened the link at the same moment) rolls back that one only, is logged with the invitation ID and error name, and the rest still expire.
- No backfill: invitations that expired or were revoked before this change keep a listing without `purgeAfter` (pre-launch dev data only).
- Follow-up (F03, media): `media/services/uploads.js` refuses uploads only for terminal statuses; it should also refuse a listing with `closedAt` set (a closed INVITED record).
- Follow-up (F08): the retention purge must include INVITED rows past `purgeAfter`, not only terminal statuses.
- Tests (2026-10-19): `core/tests/close-unused.test.js` (13: both reasons, non-INVITED refused, repeat, wrong actor or reason, OPEN on a closed record, caller rollback) and `access/tests/unused-close.test.js` (7: expiry and revoke close the record with one audit row, repeats, a listing that leaves INVITED mid-run fails alone, the error log holds IDs only). Core, platform, scheduler, access and workspace: 478 passed.
