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

`/apps/classifieds/seller/:token/pay`, `/webhooks/orders-paid`, `/webhooks/refunds-create`, metaobject pages, the browse page

## Business rules

- Nothing is charged before approval; payment of an approved listing publishes it; `expiresAt = addMonths(liveAt, 1)`.
- Fee orders: hidden fee product, `requiresShipping=false`, fulfilled immediately with `notifyCustomer: false`, tagged, **excluded from ShippingEasy**, packing slips and shipping notifications.
- `orders/paid` matches by `_classifieds_listing_id` **and** verifies the variant and amount; a mismatch or late payment → incident, no publish.
- Listings are metaobjects, never products; no Add to Cart; private-seller badge and disclaimer always shown; the **header button** sits beside Search/Account/Cart (first in the mobile drawer), never in the menu row.

## Tickets

| Ticket                      | Title                  | Status |
| --------------------------- | ---------------------- | ------ |
| [F06-T1](tickets/F06-T1.md) | Listing fee payment    | To do  |
| [F06-T2](tickets/F06-T2.md) | Go live and storefront | To do  |
