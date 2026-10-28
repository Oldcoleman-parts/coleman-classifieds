# F01-FIX-6 — Core support for the seller page: change note, submit deadline, atomic agreement

|                     |                                             |
| ------------------- | ------------------------------------------- |
| **Status**          | Done                                        |
| **Feature**         | [F01 Foundation and platform](../README.md) |
| **Module(s)**       | `core`, `workspace` (caller)                |
| **Security skills** | `security-core`, `security-workspace`       |

Start with `/implement-ticket F01-FIX-6`. Follow-up from [F04-T2](../../04-seller-journey/tickets/F04-T2.md) (Notes).

## Scope

- [x] A read function in `core/index.js` for the latest staff change-request note of a listing (today it is stored only in `AuditEvent.details` of `ChangesRequested`), e.g. `getChangesRequestNote(listingId) → { note, at } | null`. The workspace CHANGES_REQUESTED page then shows the note instead of “see the email we sent you”.
- [x] The `SUBMIT` rules refuse a submit once `draftDueBy` (DRAFT) or `correctionDueBy` (CHANGES_REQUESTED) has passed (today access’s `resolveToken()` is the only check).
- [x] An optional in-transaction hook on `transition()` (for example `{ beforeCommit(tx, listing) }`), so workspace writes `TermsAcceptance` in the same transaction as `SUBMIT` and drops its compensating delete (`app/modules/workspace/services/draft.js`).

## Out of scope

- The scheduled EXPIRE job (F08-T1).

## Acceptance criteria

- [x] The seller page shows the staff note (escaped) on a CHANGES_REQUESTED listing.
- [x] `transition(SUBMIT)` after either deadline throws `InvalidTransitionError` and writes nothing.
- [x] A refused submit leaves no `TermsAcceptance` row, without a compensating delete.
- [x] `npm run test:ai` is green for `core` and `workspace`.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Requested by F04-T2 (2026-10-06).
- 2026-10-19, built:
  - `core/listings.js` `getChangesRequestNote(listingId)` reads the latest `ChangesRequested` audit note (or null); exported from `core/index.js`. The workspace CHANGES_REQUESTED page shows it escaped (`h()`, `white-space: pre-line`).
  - Both `SUBMIT` rules have a guard with a `refusal` message ("SUBMIT isn't allowed: the deadline has passed"). The guard runs before any write.
  - `transition(…, { beforeCommit(tx, listing) })`: optional, validated before the transaction; runs after the update and audit row, inside the transaction. A throw rolls everything back and no event is dispatched. Workspace `submitListing()` writes `TermsAcceptance` with it; the compensating delete is gone.
- Decisions:
  - `// DECISION (F01-FIX-6)`: the SUBMIT cutoff is `deadline <= now`, the same moment `EXPIRE` becomes allowed; a null deadline never blocks.
  - `// DECISION (F01-FIX-6)`: the hook runs after the status update and audit entry, so it sees the changed listing and only runs once every check passed.
  - `// DECISION (F01-FIX-6)`: the rules version recorded is the one read before the transaction (a rules change in that instant could record the previous version; accepted).
  - `// DECISION (F01-FIX-6)`: without a stored note (e.g. purged), the page points to the email as before.
- No schema change, no new events. Docs: `data-model.md` (SUBMIT rows, side-effect and deadline bullets), F01 README business rule, core and workspace `CLAUDE.md`.
- Tests: `core/tests/submit-deadline.test.js`, `core/tests/before-commit.test.js`, `core/tests/change-note.test.js`, plus cases in `workspace/tests/correction.test.js` and `workspace/tests/draft.test.js`. `npm run test:ai -- app/modules/core app/modules/workspace`: 292 passed, 0 failed.
- Follow-up (optional, not ticketed): the staff console could show the same note via `getChangesRequestNote()`.
