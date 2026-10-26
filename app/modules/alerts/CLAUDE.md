# Module `alerts` — part of F07 Buyer contact and alerts

Buyers message sellers privately (with suspicious messages held for staff), and visitors subscribe to an email for each new listing.

- **Spec and tickets:** `docs/features/07-contact-and-alerts/`
- **Security skill:** `security-alerts` (loads automatically when you edit this module; audits are on demand).
- **Events:** Contact publishes `BuyerMessageHeld`. Alerts listens to `ListingWentLive` (**only if `firstTime`**) and `FeatureToggled`.

## Rules for this feature

- BLOCKED: failed Turnstile, honeypot, rate limit. HELD: links, flagged words, repeat sends (from settings) → staff notice, no delivery until released. DELIVERED: ReplyTo = buyer, never to OCP support.
- Alerts: double opt-in, one email per new listing at its first go-live (edits and renewals never), one-click unsubscribe, a separate list from OCP marketing.

## How it is built (F07-T2)

- Routes `proxy.alerts.jsx`, `proxy.alerts_.confirm.jsx`, `proxy.alerts_.unsubscribe.jsx`, `proxy.alerts_.resubscribe.jsx` → `services/pages.js` (status 200, except 404 for signup/confirm/resubscribe while the flag is off). Signup POST: IP limit (10/h) → honeypot `website` → no `cf-turnstile-response` field (the theme block) → form with Turnstile → `services/turnstile.js` (a copy, fails closed) → `services/clean.js` → email limit (3/day, `sha256(email + TOKEN_PEPPER)`) → `subscribe()`. Always the same "Check your email" page.
- `services/tokens.js`: a token is `<id>.<secret>`; only `sha256(token + TOKEN_PEPPER)` is stored, compared with `timingSafeEqual`, never logged. Confirm tokens are random and one-time; the unsubscribe token is an HMAC of the id (key from `TOKEN_PEPPER`) so every alert email can carry it. Confirm and unsubscribe GETs show a button (link scanners can't act); the one-click POST (`?t=` in the `List-Unsubscribe` address) unsubscribes straight away.
- `services/subscribers.js`: `subscribe()` resends the confirm link to new, pending and unsubscribed addresses and does nothing for active or suppressed ones. Audits carry the subscriber id only.
- `events.js`: `ListingWentLive` with `firstTime === true` and the flag on → `AlertQueue` row (`createMany skipDuplicates`, so once per listing), then `sendListingAlert()` without awaiting it (`settleAlertSends()` for tests). `FeatureToggled` (`alerts`) → `services/storefront.js` writes the `classifieds.alerts_enabled` shop metafield the theme reads. Listeners are always registered; everything checks `isEnabled("alerts")`.
- `services/send.js`: `sendListingAlert()` checks the listing (`services/facts.js` `listingState()`, public fields only: open / waiting for its storefront page / gone) → `alerts_digest` with one listing to confirmed, not-unsubscribed subscribers, key `alerts_new:<listingId>:<subscriberId>`. A suppressed address (complaint or bounce) is unsubscribed (`via SUPPRESSED`). The row is marked sent at the end; gone or stale (> 3 days) rows are dropped. `sendPendingAlerts()` (`alerts.send-pending`, hourly, 5 min): rows unsent after 15 minutes, max 10 a run. Flag off → paused.
- `services/housekeeping.js` (`alerts.housekeeping`, hourly): unconfirmed rows after 30 days, sent queue rows after 90 days, metafield re-sync.
- `services/screen.js` backs `/app/settings/alerts` (counts) and `/app/settings/alerts/export` (POST, active subscribers CSV, formula-safe, audited with the staff email).
- Storefront: `snippets/classifieds-alerts-signup.liquid` (in the browse block's slot) and the standalone `blocks/alerts-signup.liquid`. Tests use `setAlertsAdmin()`, `setTurnstileFetch()` and `resetRateLimits()`.

## Boundaries

- Export only through `index.js`. Never import other modules’ `services/`; use their `index.js` or events.
- Status changes go through `core` `transition()`.
