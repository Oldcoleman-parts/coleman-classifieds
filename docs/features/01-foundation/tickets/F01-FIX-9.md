# F01-FIX-9 — core.runOutsideEvents() helper

|                     |                                             |
| ------------------- | ------------------------------------------- |
| **Status**          | Done                                        |
| **Feature**         | [F01 Foundation and platform](../README.md) |
| **Module(s)**       | `core`                                      |
| **Security skills** | `security-core`                             |

Start with `/implement-ticket F01-FIX-9`. Raised by [F06-FIX-2](../../06-payments-and-publishing/tickets/F06-FIX-2.md) (see its Notes): the payments apply step leaves the event queue's async context with `AsyncLocalStorage.snapshot()`, so events it publishes are dispatched even when it starts inside another event's dispatch. Core should offer this as a helper.

## Scope

- [x] Export `runOutsideEvents(fn)` from core: `activeQueue.run(null, fn)` in `app/modules/core/events.js`, re-exported from `app/modules/core/index.js`, so detached work started inside an event handler dispatches its own events.
- [x] Switch payments `services/apply.js` (`app/modules/payments/services/apply.js`) from `AsyncLocalStorage.snapshot()` to `runOutsideEvents()`.
- [x] Reword the comment at `app/modules/core/payment.js:1-3` and `app/modules/core/CLAUDE.md`: "the orders/paid webhook answers 500 and Shopify retries" becomes "the payments apply step leaves appliedAt empty and its task retries".

## Out of scope

- Any other change to how `orders/paid` is answered or reconciled (F06-FIX-2, F06-FIX-3).
- Changing the alerts go-live send (it publishes no events today; see F07-T2 Notes).

## Acceptance criteria

- [x] A publish inside `runOutsideEvents()` called from an event handler is dispatched (test). `app/modules/core/tests/run-outside-events.test.js`, with a control showing a plain publish is queued.
- [x] `npm run test:ai` stays green for payments. `app/modules/core app/modules/payments`: 301 passed (2026-10-27).

## Notes

- Done 2026-10-27. `runOutsideEvents(fn)` is `activeQueue.run(null, fn)` in `core/events.js`, exported from `core/index.js`; `payments/services/apply.js` uses it in place of `AsyncLocalStorage.snapshot()`.
- DECISION: a must-succeed (`PaymentReceived`) failure inside `runOutsideEvents()` rejects to the caller of `fn`, not to the outer dispatch. `apply.js` already expects this: it catches the rejection and returns `RETRY`. Stated in the JSDoc.
- Also reworded the same out-of-date "webhook answers 500" comment above `MUST_SUCCEED` in `core/events.js` (same file and module).
