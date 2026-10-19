# F06-FIX-1 — Fee product price, sales channel and checkout error page

|                     |                                             |
| ------------------- | ------------------------------------------- |
| **Status**          | To do                                       |
| **Feature**         | [F06 Payments and publishing](../README.md) |
| **Module(s)**       | `payments`                                  |
| **Security skills** | `security-payments`                         |

Start with `/implement-ticket F06-FIX-1`. Found in the F06-T1 dev-store QA (2026-10-19, see the F06-T1 notes): the first checkout was refused twice with `CHECKOUT_PRICE` and the seller saw Shopify's "There was an error in the third-party application" page.

## Scope

- [ ] **Price in step with the base fee.** The fee variant's price follows `Settings.baseFeeCents` after it changes (today it is set only when the product is first created). Prefer a check in payments before a checkout or an approval (read the variant price, update it when it differs) over a new cross-module event; if an event is needed, add it to `docs/architecture/events.md`.
- [ ] **Discount based on the real price.** The discount is the variant's current price minus `feeOfferedCents`, not `feeRegularCents − feeOfferedCents`, so invitations made before a fee change still pay exactly their locked fee. A locked fee above the current price (the fee was lowered) is refused with a payment problem, as now.
- [ ] **Sales channel.** `ensureFeeSetup()` publishes the fee product (still Unlisted) to the channel the storefront token can see. Check the mutation and the scope (likely `write_publications`) with `/shopify-graphql`, and update `docs/architecture/shopify-config.md`; a scope change needs a re-auth on the dev store.
- [ ] **Clear error code.** A cart that comes back without the fee line (total 0) records `FEE_NOT_ON_CHANNEL` instead of `CHECKOUT_PRICE`.
- [ ] **Error pages Shopify will show.** The pay page's error pages ("We couldn't open the checkout" and the like) are served with status 200, so the app proxy shows them instead of its own 5xx error page. The payment problem is still recorded.

## Out of scope

- Changes to the invitation form or to how fees are locked on invitations (access).
- The `listing_live` email (F06-T2).

## Acceptance criteria

- [ ] After a base fee change, a new invitation at the new fee and an older one at the old fee can both pay exactly their locked fee (tests with the Shopify stand-ins).
- [ ] A fresh fee setup leaves the product Unlisted and on the storefront channel; the storefront token can put it in a cart (manual QA on the dev store).
- [ ] A refused checkout shows the app's own error page through the app proxy, not Shopify's (manual QA).
- [ ] `npm run test:ai` is green for payments.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Dev store state after QA: the fee product was set to $30.50 and published to Online Store by hand.
