# F05-FIX-2 — Refuse re-issuing a lapsed listing of an erased seller

|                     |                                   |
| ------------------- | --------------------------------- |
| **Status**          | Done                              |
| **Feature**         | [F05 Staff console](../README.md) |
| **Module(s)**       | `console`                         |
| **Security skills** | `security-console`                |

Start with `/implement-ticket F05-FIX-2`. Follow-up from [F08-FIX-8](../../08-operations-and-launch/tickets/F08-FIX-8.md) (user default Q3): a privacy redact leaves a LAPSED listing as it is, so staff could re-issue it and the pay email would go to `redacted+<id>@invalid` (refused by notifications).

## Scope

- [x] _Not needed (see Notes)._ On the review screen, hide or refuse "Re-issue" for a LAPSED listing whose seller was erased (access `isRedactedSeller()` on the seller contact, through access's `index.js`), with a short explanation.
- [x] Update console `CLAUDE.md`.

## Acceptance criteria

- [x] _Not applicable:_ re-issuing a LAPSED listing of an erased seller is refused with a clear message and changes nothing (no re-issue action exists, so there is nothing to test; see Notes).
- [x] `npm run test:ai -- app/modules/console` is green (no code changed; last run `✓ 146 passed · 0 failed`, F05-FIX-1).

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Closed as **no change needed** (user decision, 2026-10-27). The premise doesn't hold: core has a `REISSUE` rule (`core/lifecycle.js:253`, LAPSED → APPROVED_AWAITING_PAYMENT), but nothing calls it. The console's review actions (`services/review-actions.js`) are approve, request changes, reject, approve / reject a revision, pause, resume and extend; there is no re-issue action, route or button anywhere. So a LAPSED listing of an erased seller can't be re-issued today. (`access.reissueSellerLinks()` is the seller's Get my link page, unrelated; it already skips erased sellers since F08-FIX-8.)
- Recorded in console `CLAUDE.md`: if a re-issue action is ever added, it must refuse a listing whose seller was erased (access `isRedactedSeller()`).
