# F08 — Automatic renewals

|                     |                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| **Phase**           | 2                                                                                                  |
| **Module(s)**       | `app/modules/payments/renewals/`                                                                   |
| **Depends on**      | 05, 07                                                                                             |
| **Estimate**        | ~3 days                                                                                            |
| **Security skills** | `security-renewals` (guide coding automatically; audits run on demand with `/security-review F08`) |

## Purpose

Sellers opt into monthly renewal of the same listing, with the price shown first, clear consent, easy cancellation and safe failure handling.

## Owns data

`Listing` renewal fields, `FeeCharge`, `ListingPeriod`, `TermsAcceptance` (RENEWAL_CONSENT) (definitions in `docs/architecture/data-model.md`)

## Events

Publishes `RenewalSucceeded` and `RenewalFailed`. Listens to `ListingClosed`, `ListingPaused`/`Resumed` and `FeatureToggled`.

## Routes and screens

pay stage option, `/webhooks/subscription-*`, `/webhooks/billing-attempts-*`, seller turn-off

## Business rules

- The renewal price is shown before consent (FIRST_MONTH offer → base price; ALL_RENEWALS → the offered price); `agreedRenewalCents` is locked.
- No charge while PAUSED (the billing date is deferred). A failure at month end → PAYMENT_OVERDUE (hidden), 7 days, then EXPIRED; payment in the window restarts the month from the payment time.
- Sold or removed cancels immediately; turning off renewal keeps the listing until the paid end.

## Tickets

| Ticket                      | Title                             | Status |
| --------------------------- | --------------------------------- | ------ |
| [F08-T1](tickets/F08-T1.md) | Renewal consent and subscriptions | To do  |
| [F08-T2](tickets/F08-T2.md) | Billing cycle                     | To do  |
