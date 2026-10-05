# F03 — Email and photo services

|                     |                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Phase**           | 1                                                                                                                         |
| **Module(s)**       | `app/modules/notifications/`, `app/modules/media/`                                                                        |
| **Depends on**      | 01, 02                                                                                                                    |
| **Estimate**        | ~3.5 days                                                                                                                 |
| **Security skills** | `security-media`, `security-notifications` (guide coding automatically; audits run on demand with `/security-review F03`) |

## Purpose

The infrastructure services: all email through Amazon SES with templates staff can edit, plus seller photo storage in S3 delivered through CloudFront.

## Owns data

`EmailTemplate`, `EmailSettings`, `EmailSuppression`, `EmailOutbox`, `Photo` (definitions in `docs/architecture/data-model.md`)

## Events

Notifications listens to `ListingSubmitted`, `RevisionSubmitted` and `BuyerMessageHeld` (instant staff notices). The `IncidentRaised` problem email is sent by `ops` through `notifications.send()` (F08-T2). Media listens to `ListingWentLive`, `RevisionApproved` (publish) and `ListingClosed` (unpublish).

## Routes and screens

`/app/settings/emails` (added to the Settings navigation from F02), `/webhooks/ses`, `/apps/classifieds/upload-url`, `/apps/classifieds/upload-complete`

## Business rules

- Shopify email can’t be used: the app sends its own email through SES (two config sets: `transactional`, `alerts`).
- Staff notices are immediate, go to `EmailSettings.staffNotify` with the listing title and review link, and are separate from the subscriber digest.
- Every email goes through the outbox: suppression check, one try at once, then hourly retries for about a day. Emails that carry a code or private link are never stored; they are retried on the spot only.
- Every email the app sends, to staff and to sellers, has a template in the registry that staff can edit in Settings → Emails. A new email is added with `/add-email-template`, never as wording in code.
- Required placeholders can’t be removed; alert emails always carry the unsubscribe link and postal address.
- Photos are never stored in Shopify Files: `incoming/` → `private/` → `public/` (CloudFront OAC only); EXIF/GPS stripped; max 12 (from settings).

## Tickets

| Ticket                      | Title                  | Status |
| --------------------------- | ---------------------- | ------ |
| [F03-T1](tickets/F03-T1.md) | Email engine           | Done   |
| [F03-T2](tickets/F03-T2.md) | Photo storage          | To do  |
| [F03-T3](tickets/F03-T3.md) | Email settings screens | To do  |
