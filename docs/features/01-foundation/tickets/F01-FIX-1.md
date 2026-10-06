# F01-FIX-1 — A failed payment transition must not be swallowed

|                     |                                             |
| ------------------- | ------------------------------------------- |
| **Status**          | To do                                       |
| **Feature**         | [F01 Foundation and platform](../README.md) |
| **Module(s)**       | `core`                                      |
| **Security skills** | `security-core`                             |

Start with `/implement-ticket F01-FIX-1`. Fix ticket from [review 1](../../../reviews/2026-10-05-review-1.md) (High).

## Problem

Core listens to `PaymentReceived` and calls `transition(PAY)` (`app/modules/core/index.js:57-60`). The event bus catches every handler error and logs only its name (`app/modules/core/events.js:153-160`). If the transition fails (a database error, or the payment arrives after the listing lapsed), the seller has paid, the listing is not live, the webhook answers 200 and Shopify never retries.

## Scope

- [ ] The PAY path fails loudly: a failure of the `PaymentReceived` → `PAY` handler reaches the publisher, so the `orders/paid` webhook can answer 500 and be retried. Either a `publish()` mode that rethrows handler failures for this event, or payments calling `core.transition()` through `index.js`; choose one and record it.
- [ ] A payment that can never be applied (for example the listing is `LAPSED`, `REJECTED` or already closed) is not retried for ever: it is recorded so staff can refund or re-issue (`refundFlag` and an audit entry now; the `IncidentRaised` email arrives with F08).
- [ ] A repeated `PaymentReceived` for a listing that is already live stays harmless.
- [ ] Update `docs/architecture/events.md` and the F06-T1 notes with how payments must publish or call it.

## Out of scope

- The Medium and Low findings of review 1 (they stay in the report as a checklist).

## Acceptance criteria

- [ ] A `PAY` that fails with a temporary error makes the publishing call reject, and nothing is half-applied.
- [ ] A payment for a listing that can no longer go live is recorded for staff (flag and audit entry) and does not cause endless retries.
- [ ] Tests: `core.register()` with a failing and a repeated `PaymentReceived`; other events keep today’s “one failing listener doesn’t stop the rest” behaviour.
- [ ] `npm run test:ai` is green for this feature.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Found by both the F01 code review and the core security audit.
- Related Medium findings in the report (event queue drain, no replay after commit) are not part of this ticket.
