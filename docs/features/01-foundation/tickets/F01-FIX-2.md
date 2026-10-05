# F01-FIX-2 — A webhook that dies mid-handler must be retried

|                     |                                             |
| ------------------- | ------------------------------------------- |
| **Status**          | To do                                       |
| **Feature**         | [F01 Foundation and platform](../README.md) |
| **Module(s)**       | `platform`                                  |
| **Security skills** | `security-platform`                         |

Start with `/implement-ticket F01-FIX-2`. Fix ticket from [review 1](../../../reviews/2026-10-05-review-1.md) (High).

## Problem

`handleWebhook()` commits the `WebhookReceipt` before the handler runs and removes it only in a `catch` (`app/modules/platform/services/webhooks.js:56-76`). If the process dies, is redeployed or times out mid-handler, or the delete itself fails, the receipt stays. Shopify’s retry then finds the receipt, gets 200 and nothing happens. For `orders/paid` that is a paid listing that never publishes.

## Scope

- [ ] Add `processedAt` (nullable) to `WebhookReceipt` with `/schema-change`; set it only after the handler succeeds.
- [ ] A repeat delivery returns 200 without work only when the receipt is processed. An unprocessed receipt older than a short claim window (about a minute) is taken over and the handler runs again; a fresh unprocessed one (another request is working on it) answers 500 so Shopify retries later.
- [ ] A failure while removing or updating the receipt can’t turn into a 200.
- [ ] Handlers must stay idempotent, since one may now run twice: say so in `app/modules/platform/CLAUDE.md` and in the F06 ticket notes.
- [ ] Update `docs/architecture/data-model.md` and the webhook paragraph in `shopify-config.md`.

## Out of scope

- The Medium and Low findings of review 1 (they stay in the report as a checklist).

## Acceptance criteria

- [ ] A delivery whose handler never finished (receipt present, `processedAt` empty, older than the window) is processed on retry.
- [ ] A processed delivery repeated returns 200 and the handler is not called.
- [ ] A handler that throws answers 500, and the next delivery runs it again.
- [ ] The existing bad-HMAC and duplicate tests still pass.
- [ ] `npm run test:ai` is green for this feature.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Found by both the F01 code review and the platform security audit.
