# F01-FIX-1 — A failed payment transition must not be swallowed

|                     |                                             |
| ------------------- | ------------------------------------------- |
| **Status**          | Done                                        |
| **Feature**         | [F01 Foundation and platform](../README.md) |
| **Module(s)**       | `core`                                      |
| **Security skills** | `security-core`                             |

Start with `/implement-ticket F01-FIX-1`. Fix ticket from [review 1](../../../reviews/2026-10-05-review-1.md) (High).

## Problem

Core listens to `PaymentReceived` and calls `transition(PAY)` (`app/modules/core/index.js:57-60`). The event bus catches every handler error and logs only its name (`app/modules/core/events.js:153-160`). If the transition fails (a database error, or the payment arrives after the listing lapsed), the seller has paid, the listing is not live, the webhook answers 200 and Shopify never retries.

## Scope

- [x] The PAY path fails loudly: a failure of the `PaymentReceived` → `PAY` handler reaches the publisher, so the `orders/paid` webhook can answer 500 and be retried. Either a `publish()` mode that rethrows handler failures for this event, or payments calling `core.transition()` through `index.js`; choose one and record it.
- [x] A payment that can never be applied (for example the listing is `LAPSED`, `REJECTED` or already closed) is not retried for ever: it is recorded so staff can refund or re-issue (`refundFlag` and an audit entry now; the `IncidentRaised` email arrives with F08).
- [x] A repeated `PaymentReceived` for a listing that is already live stays harmless.
- [x] Update `docs/architecture/events.md` and the F06-T1 notes with how payments must publish or call it.

## Out of scope

- The Medium and Low findings of review 1 (they stay in the report as a checklist).

## Acceptance criteria

- [x] A `PAY` that fails with a temporary error makes the publishing call reject, and nothing is half-applied.
- [x] A payment for a listing that can no longer go live is recorded for staff (flag and audit entry) and does not cause endless retries.
- [x] Tests: `core.register()` with a failing and a repeated `PaymentReceived`; other events keep today’s “one failing listener doesn’t stop the rest” behaviour.
- [x] `npm run test:ai` is green for this feature.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Found by both the F01 code review and the core security audit.
- Related Medium findings in the report (event queue drain, no replay after commit) are not part of this ticket.
- **Decision D1:** option (a). `PaymentReceived` is a must-succeed event (`MUST_SUCCEED` in `core/events.js`): `publish()` rejects with the first handler failure, after all handlers and queued events have run. It is fixed per event, not a `publish()` option, so the payments code cannot forget it.
- **Decision D2:** `applyPayment()` (`core/payment.js`) is not exported. Payments reads the result with `getListingSummary()`.
- **Decision D3:** a payment for a listing that is not yet approved (`INVITED`, `DRAFT`, `SUBMITTED`, `CHANGES_REQUESTED`) is flagged and audited, not retried.
- **Decision D4:** an invalid `billingMode` is flagged and audited (reason `INVALID_EVENT`), not retried: a retry cannot fix it.
- **Decision D5:** a listing that closed after being live (`SOLD`, `REMOVED`, `EXPIRED` with `liveAt`) counts as already paid: no flag. `LAPSED` and `REJECTED` are always flagged. `PAYMENT_OVERDUE` with renewals switched off is flagged too.
- **Decision D6:** the audit action is `PaymentNotApplied`, with `orderGid`, `status` and `reason` (`NOT_PAYABLE`, `INVALID_EVENT` or `LISTING_NOT_FOUND`).
- If staff re-issue the listing between the failed PAY and the check, the handler throws `ConflictError`, so the retry applies the payment.
- Each retried delivery writes one more `PaymentReceived` audit entry, because the entry is written before the handlers run. Accepted.
- No schema change: `refundFlag` already existed and `AuditEvent.action` is free text.
- **Follow-ups (not created as tickets):**
  - F05 or F06: no console screen shows `refundFlag` yet, and nothing clears it after a refund or re-issue. Today staff see only the `PaymentNotApplied` entry in the history.
  - F06-T1 / F08-T2: raise a payment incident when a payment is not applied.
  - F09: `RenewalSucceeded` and `RenewalFailed` failures are still swallowed; add them to `MUST_SUCCEED`.
  - F01-FIX-2 is still needed before F06: a webhook that dies mid-handler is not retried.
