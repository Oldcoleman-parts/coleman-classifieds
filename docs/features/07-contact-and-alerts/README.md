# F07 — Buyer contact and alerts

|                     |                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Phase**           | 1                                                                                                                    |
| **Module(s)**       | `app/modules/contact/`, `app/modules/alerts/`                                                                        |
| **Depends on**      | 06                                                                                                                   |
| **Estimate**        | ~2.5 days                                                                                                            |
| **Security skills** | `security-alerts`, `security-contact` (guide coding automatically; audits run on demand with `/security-review F07`) |

## Purpose

Buyers message sellers privately (with suspicious messages held for staff), and visitors subscribe to a daily digest of new listings.

## Owns data

`BuyerMessage`, `AlertSubscriber`, `AlertQueue` (definitions in `docs/architecture/data-model.md`)

## Events

Contact publishes `BuyerMessageHeld`. Alerts listens to `ListingWentLive` (**only if `firstTime`**) and `FeatureToggled`.

## Routes and screens

`/apps/classifieds/contact/:handle`, `/apps/classifieds/alerts` (+ confirm, unsubscribe), `/app/settings/alerts`

## Business rules

- BLOCKED: failed Turnstile, honeypot, rate limit. HELD: links, flagged words, repeat sends (from settings) → staff notice, no delivery until released. DELIVERED: ReplyTo = buyer, never to OCP support.
- Alerts: double opt-in, a daily digest only on days with new listings, first go-live only (edits and renewals never), one-click unsubscribe, a separate list from OCP marketing.

## Tickets

| Ticket                      | Title                           | Status |
| --------------------------- | ------------------------------- | ------ |
| [F07-T1](tickets/F07-T1.md) | Buyer contact and held messages | To do  |
| [F07-T2](tickets/F07-T2.md) | New-listing email alerts        | To do  |
