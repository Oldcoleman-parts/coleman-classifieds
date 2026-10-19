# ShippingEasy: keeping listing fee orders out

A listing fee order is not a shipment. It must never appear in the ShippingEasy import, on a packing slip or in a shipping notification.

## How fee orders are recognised

| Fact             | Value                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- |
| Product handle   | `coleman-classifieds-listing-fee`                                                       |
| SKU              | `CLASSIFIEDS-FEE`                                                                       |
| Product status   | Unlisted (hidden from search, collections, the sitemap and feeds)                       |
| Physical product | No (`requiresShipping` is false), so the order has no shipping line                     |
| Fulfilment       | The app marks the order fulfilled as soon as it is paid, without notifying the customer |

The app does not tag fee orders (decision of 2026-10-08, F06-T1): tagging needs the `write_orders` scope, and the SKU is enough.

## Set-up in ShippingEasy (done by OCP, once)

The menu names differ between ShippingEasy accounts, so this is the rule to create, not a click path:

1. Add an order rule (or a store import filter) with the condition **a line item SKU is `CLASSIFIEDS-FEE`**.
2. Action: **do not import the order**. If the account has no import filter, move the order to a "do not ship" category instead.
3. Place a test fee order and confirm it does not appear in the order list.

An order that is already fulfilled and has no shippable item may be skipped by ShippingEasy anyway. That has not been confirmed for OCP's account, so the rule is still required.

## Check at QA and after any ShippingEasy change

- [ ] A paid fee order shows **Fulfilled** in Shopify admin within a minute, with no shipping line.
- [ ] The customer received no shipping confirmation email.
- [ ] The order is absent from the ShippingEasy **Orders** list and from printed packing slips.
- [ ] An ordinary store order placed at the same time is imported as usual.

If a fee order does appear in ShippingEasy, check that the fee product still has the SKU `CLASSIFIEDS-FEE` and that "This is a physical product" is off. Do not edit the fee product in other ways: the app expects exactly one variant.
