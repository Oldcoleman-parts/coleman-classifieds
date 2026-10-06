# F01-FIX-3 — Close the record of an unused invitation

|                     |                                             |
| ------------------- | ------------------------------------------- |
| **Status**          | To do                                       |
| **Feature**         | [F01 Foundation and platform](../README.md) |
| **Module(s)**       | `core`, `access` (callers)                  |
| **Security skills** | `security-core`, `security-access`          |

Start with `/implement-ticket F01-FIX-3`. Follow-up from [F04-T1](../../04-seller-journey/tickets/F04-T1.md) (Notes: an expired or revoked invitation’s INVITED listing is left as it is).

## Scope

- [ ] A core way to close the record of an unused INVITED listing whose invitation expired or was revoked: set `closedAt`, `closedReason` and `purgeAfter = closedAt + recordsRetentionDays`, so the retention purge (F08) removes it and its staff photos.
- [ ] Decide whether this is a state-machine row (INVITED → a terminal state, with its event and actor) or a core helper. Either way it goes through `core/lifecycle` (row lock, audit entry), never a direct write.
- [ ] New `closedReason` values `INVITATION_EXPIRED` and `INVITATION_REVOKED`, documented in `docs/architecture/data-model.md` (the `closedReason` list, the state machine table and the “Not status changes” line), plus any new event in `docs/architecture/events.md`.
- [ ] Access calls it from `revokeInvitation()` and `runExpiry()`.

## Out of scope

- The retention purge itself (F08).
- Closing a listing that has left INVITED (staff reject or remove it, F05).

## Acceptance criteria

- [ ] Revoking an unused invitation, or letting it expire, leaves the listing closed with the matching `closedReason` and a `purgeAfter`, and writes one audit entry.
- [ ] A listing that is no longer INVITED is refused; a repeat call (job re-run) changes nothing.
- [ ] `npm run test:ai` is green for this feature and for `access`.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Requested by F04-T1 (2026-10-06). See also the F01-T2 follow-up “decide what happens to a listing whose invitation expires unused”.
- If a new terminal state is added, check that media’s closed-listing handling and the F08 purge treat it like the other terminal states.
