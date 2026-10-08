# F01-FIX-2 — A webhook that dies mid-handler must be retried

|                     |                                             |
| ------------------- | ------------------------------------------- |
| **Status**          | Done                                        |
| **Feature**         | [F01 Foundation and platform](../README.md) |
| **Module(s)**       | `platform`                                  |
| **Security skills** | `security-platform`                         |

Start with `/implement-ticket F01-FIX-2`. Fix ticket from [review 1](../../../reviews/2026-10-05-review-1.md) (High).

## Problem

`handleWebhook()` commits the `WebhookReceipt` before the handler runs and removes it only in a `catch` (`app/modules/platform/services/webhooks.js:56-76`). If the process dies, is redeployed or times out mid-handler, or the delete itself fails, the receipt stays. Shopify’s retry then finds the receipt, gets 200 and nothing happens. For `orders/paid` that is a paid listing that never publishes.

## Scope

- [x] Add `processedAt` (nullable) to `WebhookReceipt` with `/schema-change`; set it only after the handler succeeds.
- [x] A repeat delivery returns 200 without work only when the receipt is processed. An unprocessed receipt older than a short claim window (about a minute) is taken over and the handler runs again; a fresh unprocessed one (another request is working on it) answers 500 so Shopify retries later.
- [x] A failure while removing or updating the receipt can’t turn into a 200.
- [x] Handlers must stay idempotent, since one may now run twice: say so in `app/modules/platform/CLAUDE.md` and in the F06 ticket notes.
- [x] Update `docs/architecture/data-model.md` and the webhook paragraph in `shopify-config.md`.

## Out of scope

- The Medium and Low findings of review 1 (they stay in the report as a checklist).

## Acceptance criteria

- [x] A delivery whose handler never finished (receipt present, `processedAt` empty, older than the window) is processed on retry.
- [x] A processed delivery repeated returns 200 and the handler is not called.
- [x] A handler that throws answers 500, and the next delivery runs it again.
- [x] The existing bad-HMAC and duplicate tests still pass.
- [x] `npm run test:ai` is green for this feature.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Found by both the F01 code review and the platform security audit.
- **Migration:** `20261008044755_webhook_receipt_processed_at` adds `processedAt`. Receipts older than 2 days are backfilled as processed; newer ones stay unprocessed, so a delivery Shopify is still retrying is run again.
- **Decision D1:** the claim window is 60 s (`CLAIM_WINDOW_MS` in `platform/services/webhooks.js`).
- **Decision D2:** `receivedAt` is the claim stamp (written from the app clock, reset on take-over); no separate `claimedAt` column. A slow request can therefore only release its own claim.
- **Decision D3:** the take-over is one conditional `UPDATE` (`processedAt` empty and `receivedAt` older than the window), so of two retries arriving together only one runs the handler.
- **Decision D4:** a handler that throws deletes its own claim, so the next delivery runs at once. If the delete fails the answer is still 500 and the receipt is taken over after the window.
- **Decision D5:** if `processedAt` can't be saved after the handler succeeded, the answer is 500 and the handler runs again after the window.
- **Decision D6:** a topic with no handler is marked processed and answers 200.
- Accepted: a privacy webhook that is taken over writes a second audit entry with the same webhook id (append-only, harmless).
- **Tests:** `app/modules/platform/tests/webhook-retry.test.js` (take-over, fresh claim, throw then redelivery, two deliveries together, no handler), `webhook-receipt-failure.test.js` (a failed receipt write is never a 200) and `webhooks.test.js` (bad HMAC, duplicate). Full suite green on 2026-10-08.
- **Follow-ups (not created as tickets):**
  - `.claude/skills/security-platform/SKILL.md` and `.claude/skills/add-webhook/SKILL.md` still say "a duplicate returns 200"; it is now "a processed duplicate".
  - F08: prune old processed receipts, and raise a health alert for receipts left unprocessed for over an hour.
  - F06-T1: the `orders/paid` handler must fit Shopify's 5 s timeout, or move the heavy work out of the request.
