# F02 — Email and photo services

|                     |                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Phase**           | 1                                                                                                                         |
| **Module(s)**       | `app/modules/notifications/`, `app/modules/media/`                                                                        |
| **Depends on**      | 01                                                                                                                        |
| **Estimate**        | ~3.5 days                                                                                                                 |
| **Security skills** | `security-media`, `security-notifications` (guide coding automatically; audits run on demand with `/security-review F02`) |

## Purpose

The infrastructure services: all email through Amazon SES with templates staff can edit, plus seller photo storage in S3 delivered through CloudFront.

## Owns data

`EmailTemplate`, `EmailSettings`, `EmailSuppression`, `Photo` (definitions in `docs/architecture/data-model.md`)

## Events

Notifications listens to `ListingSubmitted`, `RevisionSubmitted`, `BuyerMessageHeld` (instant staff notices) and `IncidentRaised`. Media listens to `ListingWentLive`, `RevisionApproved` (publish) and `ListingClosed` (unpublish).

## Routes and screens

`/app/settings/emails`, `/webhooks/ses`, `/apps/classifieds/upload-url`, `/apps/classifieds/upload-complete`

## Business rules

- Shopify email can’t be used: the app sends its own email through SES (two config sets: `transactional`, `alerts`).
- Staff notices are immediate, go to `EmailSettings.staffNotify` with the listing title and review link, and are separate from the subscriber digest.
- Required placeholders can’t be removed; alert emails always carry the unsubscribe link and postal address.
- Photos are never stored in Shopify Files: `incoming/` → `private/` → `public/` (CloudFront OAC only); EXIF/GPS stripped; max 12 (from settings).

## Tickets

| Ticket                      | Title         | Status |
| --------------------------- | ------------- | ------ |
| [F02-T1](tickets/F02-T1.md) | Email system  | To do  |
| [F02-T2](tickets/F02-T2.md) | Photo storage | To do  |
