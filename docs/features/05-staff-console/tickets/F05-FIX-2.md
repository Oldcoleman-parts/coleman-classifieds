# F05-FIX-2 — Refuse re-issuing a lapsed listing of an erased seller

|                     |                                   |
| ------------------- | --------------------------------- |
| **Status**          | To do                             |
| **Feature**         | [F05 Staff console](../README.md) |
| **Module(s)**       | `console`                         |
| **Security skills** | `security-console`                |

Start with `/implement-ticket F05-FIX-2`. Follow-up from [F08-FIX-8](../../08-operations-and-launch/tickets/F08-FIX-8.md) (user default Q3): a privacy redact leaves a LAPSED listing as it is, so staff could re-issue it and the pay email would go to `redacted+<id>@invalid` (refused by notifications).

## Scope

- [ ] On the review screen, hide or refuse "Re-issue" for a LAPSED listing whose seller was erased (access `isRedactedSeller()` on the seller contact, through access's `index.js`), with a short explanation.
- [ ] Update console `CLAUDE.md`.

## Acceptance criteria

- [ ] Re-issuing a LAPSED listing of an erased seller is refused with a clear message and changes nothing (test).
- [ ] `npm run test:ai -- app/modules/console` is green.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._
