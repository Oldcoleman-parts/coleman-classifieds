# F01-FIX-6 — Core support for the seller page: change note, submit deadline, atomic agreement

|                     |                                             |
| ------------------- | ------------------------------------------- |
| **Status**          | To do                                       |
| **Feature**         | [F01 Foundation and platform](../README.md) |
| **Module(s)**       | `core`, `workspace` (caller)                |
| **Security skills** | `security-core`, `security-workspace`       |

Start with `/implement-ticket F01-FIX-6`. Follow-up from [F04-T2](../../04-seller-journey/tickets/F04-T2.md) (Notes).

## Scope

- [ ] A read function in `core/index.js` for the latest staff change-request note of a listing (today it is stored only in `AuditEvent.details` of `ChangesRequested`), e.g. `getChangesRequestNote(listingId) → { note, at } | null`. The workspace CHANGES_REQUESTED page then shows the note instead of “see the email we sent you”.
- [ ] The `SUBMIT` rules refuse a submit once `draftDueBy` (DRAFT) or `correctionDueBy` (CHANGES_REQUESTED) has passed (today access’s `resolveToken()` is the only check).
- [ ] An optional in-transaction hook on `transition()` (for example `{ beforeCommit(tx, listing) }`), so workspace writes `TermsAcceptance` in the same transaction as `SUBMIT` and drops its compensating delete (`app/modules/workspace/services/draft.js`).

## Out of scope

- The scheduled EXPIRE job (F08-T1).

## Acceptance criteria

- [ ] The seller page shows the staff note (escaped) on a CHANGES_REQUESTED listing.
- [ ] `transition(SUBMIT)` after either deadline throws `InvalidTransitionError` and writes nothing.
- [ ] A refused submit leaves no `TermsAcceptance` row, without a compensating delete.
- [ ] `npm run test:ai` is green for `core` and `workspace`.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Requested by F04-T2 (2026-10-06).
