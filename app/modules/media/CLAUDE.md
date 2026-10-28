# Module `media` — part of F03 Email and photo services

The infrastructure services: all email through Amazon SES with templates staff can edit, plus seller photo storage in S3 delivered through CloudFront.

- **Spec and tickets:** `docs/features/03-email-and-photos/`
- **Security skill:** `security-media` (loads automatically when you edit this module; audits are on demand).
- **Events:** Notifications listens to `ListingSubmitted`, `RevisionSubmitted`, `BuyerMessageHeld` (instant staff notices) and `IncidentRaised`. Media listens to `ListingApproved` (records approved photos), `ListingWentLive`, `RevisionApproved` (publish) and `ListingClosed` (unpublish).

## Rules for this feature

- Shopify email can’t be used: the app sends its own email through SES (two config sets: `transactional`, `alerts`).
- Staff notices are immediate, go to `EmailSettings.staffNotify` with the listing title and review link, and are separate from the subscriber digest.
- Required placeholders can’t be removed; alert emails always carry the unsubscribe link and postal address.
- Photos are never stored in Shopify Files: `incoming/` → `private/` → `public/` (CloudFront OAC only); EXIF/GPS stripped; max 12 (from settings).

## How it is built (F03-T2)

- `createUploadUrl()` → browser PUT to `incoming/` → `completeUpload()` cleans the file into `private/` and creates the `Photo` row. The caller (F04 seller routes, F05 staff screens) must already have checked that the person may edit that listing; media only checks the actor type, the listing status (final, or `closedAt` set for a closed unused invitation, F03-FIX-4) and the limits.
- `services/process.js` is the only place that reads uploaded bytes: type from the first bytes, HEIC through `heic-decode`, then sharp re-encodes to JPEG with no metadata. Never store or serve bytes that didn’t go through it.
- Only photos with `approvedAt` are published or returned by `getPublicUrls()` (F03-FIX-2). Approval comes from `photoIds` on `ListingApproved` / `RevisionApproved` (`services/approval.js`). `publish()` does nothing for a closed listing; the hourly `media.unpublish-closed` sweep (`services/sweep.js`) cleans up after a failed `ListingClosed` handler.
- `publish()`, `unpublish()` and `unpublishOne()` are safe to repeat. Public copies get a new random name each time; public addresses come only from `getPublicUrls()` (CloudFront). `listPhotos()` preview links are private: never put them on a public page.
- Limits are in `services/limits.js`. Tests use `setS3Client(mockS3())`, `setCloudFrontClient(mockCloudFront())` and `setPresigner()`; nothing calls AWS.
- Browser code imports `client.js` (`resizeImage`, `uploadPhoto`), never `index.js`.
- AWS setup: `docs/reference/s3-cloudfront-setup.md`.

## Boundaries

- Export only through `index.js`. Never import other modules’ `services/`; use their `index.js` or events.
- Status changes go through `core` `transition()`.
