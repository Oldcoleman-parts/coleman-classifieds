# F06-FIX-3 — Reconcile paid fee orders whose webhook was lost

|                     |                                             |
| ------------------- | ------------------------------------------- |
| **Status**          | Done                                        |
| **Feature**         | [F06 Payments and publishing](../README.md) |
| **Module(s)**       | `payments`                                  |
| **Security skills** | `security-payments`                         |

Start with `/implement-ticket F06-FIX-3`. From [review 4](../../../reviews/2026-10-26-review-4.md) (C2, H3) and the dev-store QA of 2026-10-26: a paid fee order's `orders/paid` never reached the app, the listing stayed awaiting payment, and `runLapse` would have lapsed it.

## Scope

- [x] **Hourly reconcile.** A `payments.reconcile-paid-orders` task reads recent paid fee orders from the Admin API (check the query with `/shopify-graphql`: paid orders with the `CLASSIFIEDS-FEE` SKU, a recent window, with their custom attributes) and passes each one with no `FeeCharge` through the same match → charge → apply path as the webhook (F06-FIX-2), keyed by `orderGid`.
- [x] **No lapse without asking Shopify.** `runLapse` runs the reconcile (for the listings about to lapse) before it lapses anything. If Shopify can't be reached, nothing is lapsed in that run.
- [x] **No second payment.** Before `createCheckout`, the pay page checks for a paid fee order carrying this listing's attribute. If one exists, it applies it and shows an "already paid" page instead of opening a checkout.
- [x] Update `app/modules/payments/CLAUDE.md`, the F06 README and `docs/architecture/operations.md` (recovery) to match.

## Out of scope

- Answering the webhook quickly (F06-FIX-2).
- Refunds that arrive before their charge (review 4 Medium finding).

## Acceptance criteria

- [x] A paid fee order with no recorded charge is found by the reconcile task and the listing goes live once; a second run changes nothing (tests with the Shopify stand-ins).
- [x] A listing whose fee was paid but not recorded is not lapsed at its deadline; it goes live instead (test).
- [x] When Shopify can't be reached, `runLapse` lapses nothing that run (test).
- [x] The pay page for a listing with a paid but unrecorded order shows "already paid" and creates no cart (test).
- [x] An order that fails `mismatch()` during reconcile is reported as a payment problem and never publishes (SEC test).
- [x] `npm run test:ai` is green for payments.

## Notes

- Query `FEE_ORDERS_PAID` (`services/graphql/admin.js`) checked against the shopify.dev 2026-07 reference (the Dev MCP server wasn't loaded): search `sku:'CLASSIFIEDS-FEE' financial_status:paid created_at:>='…'`; `subtotalPriceSet` is after discounts and `originalUnitPriceSet` before, as `subtotal_price` and `line_items[].price` in the webhook. No scope change: `read_orders` already granted.
- DECISION: the window is `paymentWindowDays + 3` days, at most 59 (`read_orders` sees 60 without `read_all_orders`); at most 4 pages of 50 a run, logged when hit.
- DECISION: when the lapse run can't reach Shopify it also skips the discount clean-up (needs Shopify too) and reports `lapse-skipped`.
- DECISION: on POST the pay page fails closed: if the Shopify lookup fails, the seller sees "We couldn't open the checkout" and a `checkout-failed` problem is recorded. A mismatched order found there is reported and doesn't count as payment.
- DECISION: a mismatched order in the window is reported again once a day while it stays in the window (in-memory dedup), which keeps it visible.
- Follow-up (F01): `shopify.app.toml` `api_version = "2026-10"` (webhooks) differs from the Admin client's `ApiVersion.July26` (`app/shopify.server.js`). Align them or record why.
- Follow-up (review 4 Medium, late payment): if a `LATE` rule is added, compare the order's creation time with `paymentDueBy`, not the reconcile time.
- Tests: `payments/tests/reconcile.test.js` (found and live once, not lapsed, unapplied charge applied, Shopify down → nothing lapsed, mismatch SEC table, pay page "received your payment" with no checkout).
