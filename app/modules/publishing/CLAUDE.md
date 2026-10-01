# Module `publishing` — part of F05 Payments and publishing

Charge the approved seller through OCP’s checkout, then put the listing live in its own storefront section with the header button.

- **Spec and tickets:** `docs/features/05-payments-and-publishing/`
- **Security skill:** `security-publishing` (loads automatically when you edit this module; audits are on demand).
- **Events:** Payments listens to `ListingApproved` and `ListingClosed`, and publishes `PaymentReceived`. Publishing listens to `ListingWentLive`, `ListingUpdatedImmediate`, `RevisionApproved`, `ListingPaused`/`Resumed`, `ListingExtended` and `ListingClosed`.

## Rules for this feature

- Nothing is charged before approval; payment of an approved listing publishes it; `expiresAt = addMonths(liveAt, 1)`.
- Fee orders: hidden fee product, `requiresShipping=false`, fulfilled immediately with `notifyCustomer: false`, tagged, **excluded from ShippingEasy**, packing slips and shipping notifications.
- `orders/paid` matches by `_classifieds_listing_id` **and** verifies the variant and amount; a mismatch or late payment → incident, no publish.
- Listings are metaobjects, never products; no Add to Cart; private-seller badge and disclaimer always shown; the **header button** sits beside Search/Account/Cart (first in the mobile drawer), never in the menu row.

## Boundaries

- Export only through `index.js`. Never import other modules’ `services/`; use their `index.js` or events.
- Status changes go through `core` `transition()`.
