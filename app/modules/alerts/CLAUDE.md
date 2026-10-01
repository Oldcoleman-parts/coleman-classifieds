# Module `alerts` — part of F06 Buyer contact and alerts

Buyers message sellers privately (with suspicious messages held for staff), and visitors subscribe to a daily digest of new listings.

- **Spec and tickets:** `docs/features/06-contact-and-alerts/`
- **Security skill:** `security-alerts` (loads automatically when you edit this module; audits are on demand).
- **Events:** Contact publishes `BuyerMessageHeld`. Alerts listens to `ListingWentLive` (**only if `firstTime`**) and `FeatureToggled`.

## Rules for this feature

- BLOCKED: failed Turnstile, honeypot, rate limit. HELD: links, flagged words, repeat sends (from settings) → staff notice, no delivery until released. DELIVERED: ReplyTo = buyer, never to OCP support.
- Alerts: double opt-in, a daily digest only on days with new listings, first go-live only (edits and renewals never), one-click unsubscribe, a separate list from OCP marketing.

## Boundaries

- Export only through `index.js`. Never import other modules’ `services/`; use their `index.js` or events.
- Status changes go through `core` `transition()`.
