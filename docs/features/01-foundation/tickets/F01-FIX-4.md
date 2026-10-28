# F01-FIX-4 — Core exports for in-transaction events and the fee parser

|                     |                                                        |
| ------------------- | ------------------------------------------------------ |
| **Status**          | Done                                                   |
| **Feature**         | [F01 Foundation and platform](../README.md)            |
| **Module(s)**       | `core`, `console` and `access` (callers)               |
| **Security skills** | `security-core`, `security-console`, `security-access` |

Start with `/implement-ticket F01-FIX-4`. Follow-up from [F04-T1](../../04-seller-journey/tickets/F04-T1.md) (Notes: `InvitationCreated` is published after the commit).

## Scope

- [x] Export `recordEvent` and `dispatch` from `app/modules/core/index.js` (they exist in `core/events.js`), so a module can write an event’s audit row inside its own transaction and dispatch after the commit. Document the pattern in `docs/architecture/events.md`.
- [x] Access writes `InvitationCreated` with `recordEvent` inside the `createInvitation()` transaction and dispatches after the commit.
- [x] Move the dollars-to-cents form parser from `app/modules/console/services/settings.js` into core validators (next to `requireCents`), exported from `core/index.js`. Console and `access/services/screens.js` (which has a local copy) use it, and the copies are removed.

## Out of scope

- Changing which events exist or their payloads.
- Any other shared form helpers.

## Acceptance criteria

- [x] If the invitation transaction rolls back, no `InvitationCreated` audit row exists; after a commit there is exactly one, and handlers run once.
- [x] The core parser has its own tests (whole dollars, cents, too many decimals, negative, non-numeric, no floating-point rounding); the Settings and Create invitation screens behave as before.
- [x] `npm run test:ai` is green for `core`, `console` and `access`.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Requested by F04-T1 (2026-10-06).
- The two parsers may differ slightly (console’s `centsToDollars` uses integer maths, access uses `toFixed(2)`); keep console’s behaviour and move `centsToDollars` too if it fits.
- 2026-10-19 built. `dollarsToCents(value, field)` and `centsToDollars(cents)` are in `core/validators.js`, exported from `core/index.js`; the console and access copies are removed (call sites unchanged).
  - DECISION: `dollarsToCents` refuses anything that isn't a string, with the same message; the regex and message are unchanged, so both screens behave as before. No dollar cap: the range stays with `requireCents` and access's fee range check.
  - DECISION: `centsToDollars` keeps console's integer maths; negative cents give `"-1.50"` (console's copy gave `"-2.-50"`), non-integers throw. Nothing passes either today.
  - `createInvitation()` writes `InvitationCreated` with `recordEvent(tx, …)` after both creates (the audit row's `listingId` must exist) and dispatches after the commit.
- Follow-ups (not built here): payments' float money helpers (`checkout.js` `toCents`, `order-payload.js` `cents()`, `shop.js` `money()`) parse Shopify amounts, not staff input; consider integer maths in F06. Workspace `services/fields.js` `price()` is a fourth dollars parser (strips `$` and commas, uses `Math.round`); an F04 follow-up could build it on `core.dollarsToCents`.
- Tests: `core/tests/money.test.js`, `access/tests/create-invitation-events.test.js` (commit and rollback), `access/tests/screens.test.js` (Create invitation fee field); console `settings.test.js` unchanged. `npm run test:ai` for core, console and access: 425 passed (2026-10-19).
