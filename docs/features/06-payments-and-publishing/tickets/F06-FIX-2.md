# F06-FIX-2 — Answer orders/paid quickly and apply the payment after

|                     |                                             |
| ------------------- | ------------------------------------------- |
| **Status**          | Done                                        |
| **Feature**         | [F06 Payments and publishing](../README.md) |
| **Module(s)**       | `payments`                                  |
| **Security skills** | `security-payments`                         |

Start with `/implement-ticket F06-FIX-2`. From [review 4](../../../reviews/2026-10-26-review-4.md) (C1, H2) and the dev-store QA of 2026-10-26: `orders/paid` took 9–10 s from receipt to processed, against Shopify's 5 s timeout.

## Scope

- [x] **Answer first.** In the `orders/paid` request, do only `readOrder()`, `mismatch()` and the `FeeCharge` insert (unique `orderGid`). Nothing that calls Shopify, S3 or SES runs before the webhook answers. A mismatch still records its payment problem and does nothing else.
- [x] **Apply after.** A charge not yet applied (new `FeeCharge.appliedAt`, null; via `/schema-change` and `data-model.md`) is applied after the reply: publish `PaymentReceived`, fulfil the fee order, write the listing period, check for a duplicate charge, then set `appliedAt`. It starts straight after the reply (not awaited) and a scheduler task (`payments.apply-paid-charges`) is the backstop. Each step stays safe to run twice. Start the detached work outside core's event queue context (`activeQueue`), so events it publishes are dispatched; if that needs a core helper, raise it as an F01 follow-up.
- [x] **Fulfilment never fails the payment.** A fulfilment error records the incident and is retried by the task; it is no longer thrown, so it can't make Shopify redeliver and republish `PaymentReceived`.
- [x] Update `app/modules/payments/CLAUDE.md`, the F06 README and `docs/architecture/shopify-config.md` (webhook handling) to match.

## Out of scope

- Reconciling orders whose webhook never arrived (F06-FIX-3).
- Moving the slow `ListingWentLive` listeners (media copy, publishing sync, live email) out of dispatch (review 4 Medium findings).

## Acceptance criteria

- [x] The `orders/paid` handler makes no Admin, S3 or SES call before it answers, and records the charge (test with spies on the Shopify, S3 and SES stand-ins).
- [x] A recorded charge is applied once: the listing goes live, the period is written, the fee order is fulfilled, and `appliedAt` is set; a repeat delivery or a second task run changes nothing (tests).
- [x] A fulfilment failure leaves the listing live, records an incident, does not republish `PaymentReceived`, and is retried by the task (test).
- [ ] On the dev store, a paid fee order's webhook is processed in under 2 s and the listing goes live (manual QA, receipt times).
- [x] `npm run test:ai` is green for payments.

## Notes

- Migration `20261026114725_fee_charge_applied_at`: adds `FeeCharge.appliedAt`; charges already PAID are back-filled with `createdAt` (they were applied in the request).
- DECISION: a mismatched order is no longer fulfilled, so the request makes no Shopify call (ShippingEasy already leaves out the fee SKU).
- DECISION: the apply step starts from `AsyncLocalStorage.snapshot()` taken at import, so events it publishes are dispatched even when the webhook handler runs inside another event's dispatch. Follow-up F01-FIX-9: a `core.runOutsideEvents()` helper, plus rewording `core/payment.js:1-3` and `core/CLAUDE.md` ("the webhook answers 500" → "the apply step retries").
- DECISION: the task retries a charge for 7 days (10 a run, 120 s), skipping charges younger than 2 minutes; same process runs share one promise per charge, and the final `updateMany … appliedAt: null` guards across processes.
- Tests: `payments/tests/orders-paid.test.js` (answer first with no Shopify call, applied once, fulfilment retry, failed PaymentReceived retried by the task, the 2-minute guard, a payment recorded inside an event handler still publishes).
- Manual QA (AC 4) still to do on the dev store: a paid fee order's receipt → processed in under 2 s, listing live.
