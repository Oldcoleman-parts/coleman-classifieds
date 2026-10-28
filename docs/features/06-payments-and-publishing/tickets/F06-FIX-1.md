# F06-FIX-1 — Fee product price, sales channel and checkout error page

|                     |                                             |
| ------------------- | ------------------------------------------- |
| **Status**          | Done                                        |
| **Feature**         | [F06 Payments and publishing](../README.md) |
| **Module(s)**       | `payments`                                  |
| **Security skills** | `security-payments`                         |

Start with `/implement-ticket F06-FIX-1`. Found in the F06-T1 dev-store QA (2026-10-19, see the F06-T1 notes): the first checkout was refused twice with `CHECKOUT_PRICE` and the seller saw Shopify's "There was an error in the third-party application" page.

## Scope

- [x] **Price in step with the base fee.** The fee variant's price follows `Settings.baseFeeCents` after it changes (today it is set only when the product is first created). Prefer a check in payments before a checkout or an approval (read the variant price, update it when it differs) over a new cross-module event; if an event is needed, add it to `docs/architecture/events.md`.
- [x] **Discount based on the real price.** The discount is the variant's current price minus `feeOfferedCents`, not `feeRegularCents − feeOfferedCents`, so invitations made before a fee change still pay exactly their locked fee. A locked fee above the current price (the fee was lowered) is refused with a payment problem, as now.
- [x] **Sales channel.** `ensureFeeSetup()` publishes the fee product (still Unlisted) to the channel the storefront token can see. Check the mutation and the scope (likely `write_publications`) with `/shopify-graphql`, and update `docs/architecture/shopify-config.md`; a scope change needs a re-auth on the dev store.
- [x] **Clear error code.** A cart that comes back without the fee line (total 0) records `FEE_NOT_ON_CHANNEL` instead of `CHECKOUT_PRICE`.
- [x] **Error pages Shopify will show.** The pay page's error pages ("We couldn't open the checkout" and the like) are served with status 200, so the app proxy shows them instead of its own 5xx error page. The payment problem is still recorded.

## Out of scope

- Changes to the invitation form or to how fees are locked on invitations (access).
- The `listing_live` email (F06-T2).

## Acceptance criteria

- [x] After a base fee change, a new invitation at the new fee and an older one at the old fee can both pay exactly their locked fee (tests with the Shopify stand-ins). — `fee-change.test.js` "AC: after a base fee change…"
- [x] A fresh fee setup leaves the product Unlisted and on the storefront channel; the storefront token can put it in a cart (manual QA on the dev store). — manual QA 2026-10-19: setup re-run (ids cleared, product adopted by handle), Unlisted, on Online Store, checkout showed the locked fee; also `setup.test.js` "AC: a fresh fee setup publishes…"
- [x] A refused checkout shows the app's own error page through the app proxy, not Shopify's (manual QA). — manual QA 2026-10-19: product removed from Online Store → app's "We couldn't open the checkout" page; next click re-published and opened checkout. A hand-edited price was set back before checkout. Also `pay.test.js` "AC: a refused checkout shows the app's own error page with status 200"
- [x] `npm run test:ai` is green for payments. — 54 passed, 0 failed (2026-10-19)

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Dev store state after QA: the fee product was set to $30.50 and published to Online Store by hand.
- DECISION: `syncFeePrice()` (`services/setup.js`) runs before every approval and checkout, uncached (one Admin query). Settings are the source of truth: a price edited by hand in Shopify is put back (audit `FeePriceSynced`). No new event was needed.
- DECISION: `ensureDiscount()` now looks the code up by its text first (the text names the listing and its deadline; a stored id may belong to an earlier approval) and updates the amount in place when the price changed (audit `DiscountAmountChanged`). The code, usage limit and end date are unchanged.
- DECISION: a locked fee above the current price still sends the approval email; the checkout refuses with `FEE_ABOVE_PRICE` (payment problem, no cart).
- DECISION: fee setup publishes to the publication whose catalog title is "Online Store" (`FEE_CHANNEL` if none). A store set up before this fix is repaired by a best-effort re-publish when a cart comes back empty (`FEE_NOT_ON_CHANNEL`): the seller's next try works.
- DECISION: `orders/paid` now refuses any discount code other than the listing's own, and needs the own code whenever the line's pre-discount price differs from the locked fee.
- DECISION: every pay-page error page is status 200 (the app proxy hides 5xx, and 4xx pass-through isn't documented).
- New scope `write_publications` (`shopify.app.toml`, `shopify-config.md`): re-auth on the dev store; `shopify app deploy` for production (human).
- Follow-up (access, not ticketed yet): access seller pages through the proxy still return 4xx/5xx statuses and may hit the same Shopify error page.
- QA note: the fresh-setup check adopted the existing fee product by handle (the product was not deleted in Shopify), so the publish step was exercised but product creation was not re-run on the dev store; creation is covered by `setup.test.js`.
- Closed 2026-10-19.
