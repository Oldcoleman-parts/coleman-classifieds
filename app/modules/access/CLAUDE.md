# Module `access` — part of F04 Seller journey

Everything the seller does: the private one-listing invitation and the seller page where they prepare, submit, correct and manage their listing.

- **Spec and tickets:** `docs/features/04-seller-journey/`
- **Security skill:** `security-access` (loads automatically when you edit this module; audits are on demand).
- **Events:** Publishes `InvitationCreated`. Triggers `ListingSubmitted` (NEW / CORRECTED), `RevisionSubmitted` and `ListingUpdatedImmediate`. Listens to `ListingClosed` and `ListingRejected` to close the link.

## Rules for this feature

- Token: 32 random bytes, stored only as `sha256(token+PEPPER)`; one listing per invitation (DB unique constraint).
- Fee and offer scope (FIRST_MONTH / ALL_RENEWALS) are locked at creation; unused invitations expire after 30 days.
- Rules shown to sellers: lanterns and stoves of any brand; accessories and manuals only with equipment; no separate parts or documentation. The agreement box is **unticked by default**, and the version, date and time are recorded.
- Drafts: 14 days from start; corrections: 14 days. Live: price, quantity, availability note and photo removal are immediate; title, description and photo additions create a revision. No adding or replacing merchandise.

## How it is built (F04-T1)

- `services/tokens.js`: 32-byte tokens, `sha256(token + TOKEN_PEPPER)` only, constant-time comparison. Never log a token, a code or a request URL.
- `resolveToken()` is the start of every seller request: invitation status, expiry and listing state, every time.
- Email codes (`services/email-codes.js`) and the device credential (`services/device.js`): the app proxy strips cookies, so the signed credential travels in `localStorage` and comes back by POST (`device` field or `X-CC-Device`).
- `services/seller-gate.js` holds the storefront handlers; `services/seller-pages.js` renders escaped Liquid pages with `Referrer-Policy: no-referrer` and `no-store`.
- Admin screens: `services/screens.js` (routes `app.invitations.*`). The hourly task is `access.expire-invitations`.
- Tests: `resetRateLimits()` from `services/rate-limit.js` between tests.

## Boundaries

- Export only through `index.js`. Never import other modules’ `services/`; use their `index.js` or events.
- Status changes go through `core` `transition()`.
