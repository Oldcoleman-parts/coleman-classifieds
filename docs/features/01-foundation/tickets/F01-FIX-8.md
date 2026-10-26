# F01-FIX-8 — Log every webhook delivery that isn't answered 200

|                     |                                             |
| ------------------- | ------------------------------------------- |
| **Status**          | Done                                        |
| **Feature**         | [F01 Foundation and platform](../README.md) |
| **Module(s)**       | `platform`                                  |
| **Security skills** | `security-platform`                         |

Start with `/implement-ticket F01-FIX-8`. From [review 4](../../../reviews/2026-10-26-review-4.md) (H1): in the dev-store QA of 2026-10-26 a paid order's `orders/paid` left no receipt and no log line, so the cause couldn't be traced.

## Scope

- [x] `handleWebhook()` (`app/modules/platform/services/webhooks.js`) writes one log line on every non-2xx answer: a bad or missing signature (401/405), an error thrown by `authenticate.webhook` that isn't a `Response`, a `claim()` database error, a busy claim (500), a handler failure and a receipt that can't be saved. The line holds the topic, the `webhookId` when known, the step and the error class/code only: never the payload, headers or a token.
- [x] An unexpected error from `authenticate.webhook` or `claim()` answers 500 (Shopify retries) instead of escaping the route.
- [x] Update `app/modules/platform/CLAUDE.md` (webhook receipts) to match.

## Out of scope

- Answering `orders/paid` quickly and reconciling lost orders (F06-FIX-2, F06-FIX-3).

## Acceptance criteria

- [x] Each non-2xx path writes exactly one log line with the topic and step, and no payload, header or token text (tests with a console spy).
- [x] A database error in `claim()` answers 500 and is logged (test).
- [x] `npm run test:ai` is green for platform.

## Notes

- Steps logged: `method` (405), `signature` (401), `authenticate`, `claim`, `busy`, `handler`, `handler, claim kept` (one line for both errors), `receipt` (all 500).
- DECISION: before the signature is checked, the topic header is logged only normalised (`[A-Z0-9_]`, 64 chars) and the webhook ID header is not logged (`-`).
- DECISION: an unexpected `authenticate.webhook` error (e.g. a missing API secret) answers 500, so Shopify retries until the log shows the cause.
- Tests: `platform/tests/webhook-logging.test.js` (signature, method, authenticate, busy, handler, none on 200) and `webhook-receipt-failure.test.js` (claim, receipt, claim kept).
