# Module `payments/renewals` — part of F09 Automatic renewals

Sellers opt into monthly renewal of the same listing, with the price shown first, clear consent, easy cancellation and safe failure handling.

- **Spec and tickets:** `docs/features/09-renewals/`
- **Security skill:** `security-renewals` (loads automatically when you edit this module; audits are on demand).
- **Events:** Publishes `RenewalSucceeded` and `RenewalFailed`. Listens to `ListingClosed`, `ListingPaused`/`Resumed` and `FeatureToggled`.

## Rules for this feature

- The renewal price is shown before consent (FIRST_MONTH offer → base price; ALL_RENEWALS → the offered price); `agreedRenewalCents` is locked.
- No charge while PAUSED (the billing date is deferred). A failure at month end → PAYMENT_OVERDUE (hidden), 7 days, then EXPIRED; payment in the window restarts the month from the payment time.
- Sold or removed cancels immediately; turning off renewal keeps the listing until the paid end.

## Boundaries

- Export only through `index.js`. Never import other modules’ `services/`; use their `index.js` or events.
- Status changes go through `core` `transition()`.
