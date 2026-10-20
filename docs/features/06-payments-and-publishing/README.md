# F06 — Payments and publishing

|                     |                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Phase**           | 1                                                                                                                         |
| **Module(s)**       | `app/modules/payments/`, `app/modules/publishing/`                                                                        |
| **Depends on**      | 03, 05                                                                                                                    |
| **Estimate**        | ~4.5 days                                                                                                                 |
| **Security skills** | `security-payments`, `security-publishing` (guide coding automatically; audits run on demand with `/security-review F06`) |

## Purpose

Charge the approved seller through OCP’s checkout, then put the listing live in its own storefront section with the header button.

## Owns data

`FeeCharge`, `ListingPeriod`, fee product, variant and selling plan GIDs in `Settings`; the `classified_listing` metaobject; the `classifieds.live_count` metafield (definitions in `docs/architecture/data-model.md`)

## Events

Payments listens to `ListingApproved` and `ListingClosed`, and publishes `PaymentReceived`. Publishing listens to `ListingWentLive`, `ListingUpdatedImmediate`, `RevisionApproved`, `ListingPaused`/`Resumed`, `ListingExtended` and `ListingClosed`.

## Routes and screens

`/apps/classifieds/pay/:ref` (GET the pay page, POST starts the checkout; `:ref` is the signed pay link from the email, F06-T1), `/webhooks/orders/paid`, `/webhooks/refunds/create`, metaobject pages, the browse page

## Business rules

- Nothing is charged before approval; payment of an approved listing publishes it; `expiresAt = addMonths(liveAt, 1)`.
- Fee orders: hidden fee product, `requiresShipping=false`, fulfilled immediately with `notifyCustomer: false`, recognised by the SKU `CLASSIFIEDS-FEE` (not tagged, F06-T1), **excluded from ShippingEasy**, packing slips and shipping notifications.
- `orders/paid` matches by `_classifieds_listing_id` **and** verifies the variant, the amount and the listing's own discount code (no other code allowed, F06-FIX-1); a mismatch or late payment → incident, no publish.
- The fee product is **Unlisted**, on the Online Store channel, and its price follows the base fee in settings (synced before each approval and checkout, F06-FIX-1); each seller's locked fee is reached with a single-use discount code worth the current price minus that fee (updated in place after a fee change), and no checkout opens unless the cart total equals that fee. A payment started before the deadline still goes live if it lands before the lapse task runs.
- A refund marks the charge and raises an incident; the listing stays as it is until staff decide.
- Listings are metaobjects, never products; no Add to Cart; private-seller badge and disclaimer always shown; the **header button** sits beside Search/Account/Cart (first in the mobile drawer), never in the menu row; a floating **Classifieds button** app embed (bottom left or right) is an optional alternative that needs no theme code.

## Tickets

| Ticket                            | Title                                                    | Status |
| --------------------------------- | -------------------------------------------------------- | ------ |
| [F06-T1](tickets/F06-T1.md)       | Listing fee payment                                      | Done   |
| [F06-T2](tickets/F06-T2.md)       | Go live and storefront                                   | In progress |
| [F06-FIX-1](tickets/F06-FIX-1.md) | Fee product price, sales channel and checkout error page | Done   |
