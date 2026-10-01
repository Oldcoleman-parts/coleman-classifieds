---
name: security-payments
description: Security and privacy checklist for the Coleman Classifieds payments module (Fee checkout, discount codes, payment detection and fulfilment.) Loads automatically while writing code in this module, so follow it as you build. Formal audits use it on demand via /security-review or /review-all.
paths:
  - "app/modules/payments/**"
  - "app/routes/webhooks.orders*"
  - "app/routes/webhooks.refunds*"
---

# Security checklist: payments

Apply `.claude/rules/01-security-baseline.md` plus the following.

## Checklist

- [ ] Checkout is only created for APPROVED_AWAITING_PAYMENT before `paymentDueBy`; the price comes from the server (locked invitation fee), never from the client.
- [ ] Discount codes are single-use, restricted to the fee product, random and unguessable, and deleted on lapse or close.
- [ ] `orders/paid` matches by `_classifieds_listing_id` **and** verifies the order contains the fee variant and the paid amount matches the expected fee. A mismatch raises an incident and doesn’t publish.
- [ ] Idempotent on the order ID; a late payment never publishes.
- [ ] Fulfilment is silent (`notifyCustomer: false`); the fee variant has `requiresShipping=false`; orders are tagged for the ShippingEasy exclusion.
- [ ] The storefront token is stored encrypted, with minimal unauthenticated scopes.

## Required security tests

- a tampered attribute or an amount mismatch → incident, no publish
- a duplicate orders/paid → one effect
- a checkout after the deadline is refused

## Reporting

List each failed item as **Critical / High / Medium / Low**, with the file, line and a concrete fix. Critical and High findings become fix tickets via `/review-all`, and must be resolved before launch.
