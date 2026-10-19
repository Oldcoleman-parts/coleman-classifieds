# Module `payments` — part of F06 Payments and publishing

Charge the approved seller through OCP’s checkout, then put the listing live in its own storefront section with the header button.

- **Spec and tickets:** `docs/features/06-payments-and-publishing/`
- **Security skill:** `security-payments` (loads automatically when you edit this module; audits are on demand).
- **Events:** Payments listens to `ListingApproved` and `ListingClosed`, and publishes `PaymentReceived`. Publishing listens to `ListingWentLive`, `ListingUpdatedImmediate`, `RevisionApproved`, `ListingPaused`/`Resumed`, `ListingExtended` and `ListingClosed`.

## Rules for this feature

- Nothing is charged before approval; payment of an approved listing publishes it; `expiresAt = addMonths(liveAt, 1)`.
- Fee orders: hidden fee product, `requiresShipping=false`, fulfilled immediately with `notifyCustomer: false`, recognised by the SKU `CLASSIFIEDS-FEE` (not tagged), **excluded from ShippingEasy**, packing slips and shipping notifications.
- `orders/paid` matches by `_classifieds_listing_id` **and** verifies the variant and amount; a mismatch or late payment → incident, no publish.
- Listings are metaobjects, never products; no Add to Cart; private-seller badge and disclaimer always shown; the **header button** sits beside Search/Account/Cart (first in the mobile drawer), never in the menu row.

## How it is built (F06-T1)

- `services/setup.js` `ensureFeeSetup({ admin })`: the Unlisted fee product (found by handle first) and the encrypted storefront token, created when first needed. Call it before any use of the variant or the token.
- `services/approval.js`: on `ListingApproved`, the discount code (`services/discount.js`, derived by HMAC, only its Shopify id is stored) and then the `approved_pay` email. The listener never throws; `payments.approval-follow-up` retries.
- `services/pay-link.js`: the signed pay link `<listingId>.<signature>`, bound to `paymentDueBy`. Never log it. `services/pay-page.js` serves `/apps/classifieds/pay/:ref`; `services/checkout.js` creates the cart and refuses to redirect unless the total is the locked fee.
- `services/orders-paid.js`: ignore ordinary orders, check everything (`mismatch()`), save `FeeCharge` by unique `orderGid`, fulfil silently, `await publish(PaymentReceived)` uncaught, then check `liveAt`. Every step is safe to run twice.
- `services/incidents.js` `reportPaymentProblem()` is the seam for F08 incidents (an audit entry and a log line for now).
- Outside a request (listeners, tasks) Shopify is reached with `offlineAdmin()` and `SHOP_DOMAIN`; tests use `setOfflineAdmin()`, `setStorefrontFetch()`, `resetFeeSetupCache()`, `resetPaymentProblems()` and platform's `resetRateLimits()`.
- The pay page is rate-limited with `platform.rateLimit()` (60 GETs a minute per IP; POST: 10 a minute per IP and 10 an hour per listing).
- F06-FIX-1: `syncFeePrice()` (setup.js) puts the variant's price back to `baseFeeCents` before every approval and checkout; `discountFor(payable, price)` = price − `feeOfferedCents`, and `ensureDiscount()` looks the code up by its text and updates its amount in place. Fee setup publishes the product to Online Store (`write_publications`); an empty cart re-publishes and fails as `FEE_NOT_ON_CHANNEL`, a locked fee above the price as `FEE_ABOVE_PRICE`. Pay-page error pages are all status 200 (the app proxy hides error statuses behind its own page).
- `services/facts.js` is the only file that reads `Listing` and `Invitation`; payments writes only `Listing.discountCodeId`.

## Boundaries

- Export only through `index.js`. Never import other modules’ `services/`; use their `index.js` or events.
- Status changes go through `core` `transition()`.
