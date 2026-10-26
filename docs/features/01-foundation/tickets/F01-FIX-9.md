# F01-FIX-9 — core.runOutsideEvents() helper

|                     |                                             |
| ------------------- | ------------------------------------------- |
| **Status**          | To do                                       |
| **Feature**         | [F01 Foundation and platform](../README.md) |
| **Module(s)**       | `core`                                      |
| **Security skills** | `security-core`                             |

Start with `/implement-ticket F01-FIX-9`. Raised by [F06-FIX-2](../../06-payments-and-publishing/tickets/F06-FIX-2.md) (see its Notes): the payments apply step leaves the event queue's async context with `AsyncLocalStorage.snapshot()`, so events it publishes are dispatched even when it starts inside another event's dispatch. Core should offer this as a helper.

## Scope

- [ ] Export `runOutsideEvents(fn)` from core: `activeQueue.run(null, fn)` in `app/modules/core/events.js`, re-exported from `app/modules/core/index.js`, so detached work started inside an event handler dispatches its own events.
- [ ] Switch payments `services/apply.js` (`app/modules/payments/services/apply.js`) from `AsyncLocalStorage.snapshot()` to `runOutsideEvents()`.
- [ ] Reword the comment at `app/modules/core/payment.js:1-3` and `app/modules/core/CLAUDE.md`: "the orders/paid webhook answers 500 and Shopify retries" becomes "the payments apply step leaves appliedAt empty and its task retries".

## Out of scope

- Any other change to how `orders/paid` is answered or reconciled (F06-FIX-2, F06-FIX-3).
- Changing the alerts go-live send (it publishes no events today; see F07-T2 Notes).

## Acceptance criteria

- [ ] A publish inside `runOutsideEvents()` called from an event handler is dispatched (test).
- [ ] `npm run test:ai` stays green for payments.

## Notes
