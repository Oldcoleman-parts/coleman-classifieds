# Module `contact` — part of F07 Buyer contact and alerts

Buyers message sellers privately (with suspicious messages held for staff), and visitors subscribe to an email for each new listing.

- **Spec and tickets:** `docs/features/07-contact-and-alerts/`
- **Security skill:** `security-contact` (loads automatically when you edit this module; audits are on demand).
- **Events:** Contact publishes `BuyerMessageHeld`. Alerts listens to `ListingWentLive` (**only if `firstTime`**) and `FeatureToggled`.

## Rules for this feature

- BLOCKED: failed Turnstile, honeypot, rate limit. HELD: links, flagged words, repeat sends (from settings) → staff notice, no delivery until released. DELIVERED: ReplyTo = buyer, never to OCP support.
- Alerts: double opt-in, one email per new listing at its first go-live (edits and renewals never), one-click unsubscribe, a separate list from OCP marketing.

## How it is built (F07-T1)

- Route `proxy.contact.$handle.jsx` → `services/pages.js`. The listing is resolved by `metaobjectHandle` on every GET and POST (`services/facts.js`, the only reader of `Listing`/`Invitation`); only LIVE and unexpired listings take messages. Every page is status 200 (the app proxy hides error statuses).
- POST order: IP limit (10/h) → honeypot (`website`, fake "sent") → listing open → Turnstile (`services/turnstile.js`, a copy of access's, fails closed) → `services/clean.js` (CR/LF and control characters out of name; email with CR/LF refused; body ≤ 2000) → email limit (5/h, key `sha256(email + TOKEN_PEPPER)`) and listing limit (20/day) → `submitMessage()`. Blocked attempts are not stored.
- `services/classify.js`: `LINK`, `KEYWORD`, `REPEAT` (buyer address's messages in the last 24 h ≥ `repeatThreshold`). Held: row + `BuyerMessageHeld` in one transaction, dispatched after commit; notifications emails staff. Held and delivered show the buyer the same page.
- `services/messages.js`: delivery sends `buyer_message` (ReplyTo = buyer) keyed `buyer_message:<id>`; it is sensitive (never queued), so a FAILED send deletes the row and the buyer is asked to retry. SENT stores `sesMessageId` (returned by `notifications.send()`), logs it and audits `BuyerMessageDelivered` (IDs only). `release()` claims HELD → RELEASED with one conditional update (exactly once), sends keyed `buyer_message:<id>:release:<random>`, and on FAILED undoes the claim and throws `ConflictError`. `discard()` never sends.
- `listHeld`/`release`/`discard` reach the `/app/messages` screen through `console.setMessageProvider()` in `app/bootstrap.server.js`; console writes the staff audit.
- Storefront: the listing block's "Contact the seller" link (`extensions/classifieds-theme/blocks/listing.liquid`). Tests use `setTurnstileFetch()` and platform's `resetRateLimits()`.
- F08-T5 (privacy redact, called by ops): `eraseBuyer(email)` / `eraseAllBuyers()` (`services/erase.js`) blank a message's buyer name, email, body and ip to `""`. The row and its status stay: a HELD message stays HELD.

## Boundaries

- Export only through `index.js`. Never import other modules’ `services/`; use their `index.js` or events.
- Status changes go through `core` `transition()`.
