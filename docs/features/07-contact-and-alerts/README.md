# F07 — Buyer contact and alerts

|                     |                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Phase**           | 1                                                                                                                    |
| **Module(s)**       | `app/modules/contact/`, `app/modules/alerts/`                                                                        |
| **Depends on**      | 06                                                                                                                   |
| **Estimate**        | ~2.5 days                                                                                                            |
| **Security skills** | `security-alerts`, `security-contact` (guide coding automatically; audits run on demand with `/security-review F07`) |

## Purpose

Buyers message sellers privately (with suspicious messages held for staff), and visitors subscribe to an email for each new listing.

## Owns data

`BuyerMessage`, `AlertSubscriber`, `AlertQueue` (definitions in `docs/architecture/data-model.md`)

## Events

Contact publishes `BuyerMessageHeld`. Alerts listens to `ListingWentLive` (**only if `firstTime`**) and `FeatureToggled`.

## Routes and screens

`/apps/classifieds/contact/:handle`, `/apps/classifieds/alerts` (+ confirm, unsubscribe, resubscribe), `/app/settings/alerts` (+ CSV export)

## Business rules

- BLOCKED: failed Turnstile, honeypot, rate limit (turned away, not stored). HELD: links, flagged words, repeat sends (from settings) → staff notice, no delivery until released. DELIVERED: ReplyTo = buyer, never to OCP support. Held and delivered messages show the buyer the same "sent" page. Repeat sends = the buyer address's messages in the last 24 hours across all listings. The listing page links to the form with "Contact the seller".
- Alerts: double opt-in, one email per new listing, sent as soon as it first goes live (edits and renewals never), one-click unsubscribe, a separate list from OCP marketing. An hourly run sends any alert a go-live didn't finish; a subscriber never gets the same listing twice. Confirm and unsubscribe links open a page with a button; the mail app's one-click unsubscribe works straight away. A complaint or hard bounce unsubscribes the address. With alerts off, the signup is hidden and alerts pause; unsubscribe still works.

## Tickets

| Ticket                      | Title                           | Status |
| --------------------------- | ------------------------------- | ------ |
| [F07-T1](tickets/F07-T1.md) | Buyer contact and held messages | Done   |
| [F07-T2](tickets/F07-T2.md) | New-listing email alerts        | Done   |
