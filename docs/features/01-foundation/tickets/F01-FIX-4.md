# F01-FIX-4 — Core exports for in-transaction events and the fee parser

|                     |                                                        |
| ------------------- | ------------------------------------------------------ |
| **Status**          | To do                                                  |
| **Feature**         | [F01 Foundation and platform](../README.md)            |
| **Module(s)**       | `core`, `console` and `access` (callers)               |
| **Security skills** | `security-core`, `security-console`, `security-access` |

Start with `/implement-ticket F01-FIX-4`. Follow-up from [F04-T1](../../04-seller-journey/tickets/F04-T1.md) (Notes: `InvitationCreated` is published after the commit).

## Scope

- [ ] Export `recordEvent` and `dispatch` from `app/modules/core/index.js` (they exist in `core/events.js`), so a module can write an event’s audit row inside its own transaction and dispatch after the commit. Document the pattern in `docs/architecture/events.md`.
- [ ] Access writes `InvitationCreated` with `recordEvent` inside the `createInvitation()` transaction and dispatches after the commit.
- [ ] Move the dollars-to-cents form parser from `app/modules/console/services/settings.js` into core validators (next to `requireCents`), exported from `core/index.js`. Console and `access/services/screens.js` (which has a local copy) use it, and the copies are removed.

## Out of scope

- Changing which events exist or their payloads.
- Any other shared form helpers.

## Acceptance criteria

- [ ] If the invitation transaction rolls back, no `InvitationCreated` audit row exists; after a commit there is exactly one, and handlers run once.
- [ ] The core parser has its own tests (whole dollars, cents, too many decimals, negative, non-numeric, no floating-point rounding); the Settings and Create invitation screens behave as before.
- [ ] `npm run test:ai` is green for `core`, `console` and `access`.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Requested by F04-T1 (2026-10-06).
- The two parsers may differ slightly (console’s `centsToDollars` uses integer maths, access uses `toFixed(2)`); keep console’s behaviour and move `centsToDollars` too if it fits.
