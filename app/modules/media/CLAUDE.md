# Module `media` — part of F03 Email and photo services

The infrastructure services: all email through Amazon SES with templates staff can edit, plus seller photo storage in S3 delivered through CloudFront.

- **Spec and tickets:** `docs/features/03-email-and-photos/`
- **Security skill:** `security-media` (loads automatically when you edit this module; audits are on demand).
- **Events:** Notifications listens to `ListingSubmitted`, `RevisionSubmitted`, `BuyerMessageHeld` (instant staff notices) and `IncidentRaised`. Media listens to `ListingWentLive`, `RevisionApproved` (publish) and `ListingClosed` (unpublish).

## Rules for this feature

- Shopify email can’t be used: the app sends its own email through SES (two config sets: `transactional`, `alerts`).
- Staff notices are immediate, go to `EmailSettings.staffNotify` with the listing title and review link, and are separate from the subscriber digest.
- Required placeholders can’t be removed; alert emails always carry the unsubscribe link and postal address.
- Photos are never stored in Shopify Files: `incoming/` → `private/` → `public/` (CloudFront OAC only); EXIF/GPS stripped; max 12 (from settings).

## Boundaries

- Export only through `index.js`. Never import other modules’ `services/`; use their `index.js` or events.
- Status changes go through `core` `transition()`.
