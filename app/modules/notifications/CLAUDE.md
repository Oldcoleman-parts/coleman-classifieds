# Module `notifications` — part of F03 Email and photo services

The infrastructure services: all email through Amazon SES with templates staff can edit, plus seller photo storage in S3 delivered through CloudFront.

- **Spec and tickets:** `docs/features/03-email-and-photos/`
- **Security skill:** `security-notifications` (loads automatically when you edit this module; audits are on demand).
- **Events:** Notifications listens to `ListingSubmitted`, `RevisionSubmitted`, `BuyerMessageHeld` (instant staff notices) and `IncidentRaised`. Media listens to `ListingWentLive`, `RevisionApproved` (publish) and `ListingClosed` (unpublish).

## Rules for this feature

- Shopify email can’t be used: the app sends its own email through SES (two config sets: `transactional`, `alerts`).
- Staff notices are immediate, go to `EmailSettings.staffNotify` with the listing title and review link, and are separate from the subscriber digest.
- Required placeholders can’t be removed; alert emails always carry the unsubscribe link and postal address.
- Photos are never stored in Shopify Files: `incoming/` → `private/` → `public/` (CloudFront OAC only); EXIF/GPS stripped; max 12 (from settings).

## How it is built (F03-T1)

- `registry.js` lists every template key: stream, placeholders, required ones, sample data. Add one with `/add-email-template`; default wording is in `emails/defaults.js`.
- Send only through `send(key, to, vars)`. It checks suppression, writes an `EmailOutbox` row and retries. Templates marked `sensitive` never have their data stored.
- Tests use `setSesClient(mockSes())` and `setSnsFetch()`; nothing calls AWS.
- Report trouble with `reportEmailProblem()` (the seam for F08 incidents). Log ids and codes only.
- `getEmailStatuses(keys)` (F03-FIX-5): up to 1000 idempotency keys in one query → `Map<key, status>`, status only; keys with no row (never sent, or removed after 30 days) are left out. For ops' batches (F08-FIX-5).

## Seller links in emails (F03-T4)

- `seller_link` is optional everywhere: callers that only have the link hash leave it out and pass `get_link_url` (the Get my link page; anything else is refused).
- List caps live in the registry (`limits`); `cleanVars` cuts the list and sets `more_count`.
- When a default wording changes, add the old one to `emails/superseded.js`; untouched stored copies are then upgraded on first read.

## Screens (F03-T3)

- `services/screens.js` backs Settings → Emails (`/app/settings/emails`, `/app/settings/emails/<key>`); the routes only authenticate and call it.
- Every registry template needs `audience`, `label` and `description`; the list and the editor are built from them.
- Email settings change only through `updateEmailSettings()` (validation and audit). A test email goes to the session’s staff email or to an address staff type; it sends sample data only, is limited to 10 an hour per staff member and is audited with the recipient.
- Previews are shown in an empty-sandbox iframe, never as page HTML.
- F08-T5 (privacy redact, called by ops): `eraseAddress(email)` / `eraseAllAddresses()` (`services/erase.js`) delete outbox rows sent to the address or with it as reply-to (a relayed buyer message), and its suppression entry.
- F08-FIX-8: an erased suppression is kept as `EmailSuppressionMarker` (`services/hash.js`: sha256(email + TOKEN_PEPPER)) and `isSuppressed()` checks it. `buyer_message` is `requiresReplyTo`: `send()` refuses it without one. `finish()` tolerates a row deleted mid-send.

## Boundaries

- Export only through `index.js`. Never import other modules’ `services/`; use their `index.js` or events.
- Status changes go through `core` `transition()`.
