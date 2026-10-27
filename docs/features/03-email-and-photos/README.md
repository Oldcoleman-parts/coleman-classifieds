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

Notifications listens to `ListingSubmitted`, `RevisionSubmitted` and `BuyerMessageHeld` (instant staff notices). The `IncidentRaised` problem email is sent by `ops` through `notifications.send()` (F08-T2). Media listens to `ListingApproved` (records which photos staff approved), `ListingWentLive`, `RevisionApproved` (publish) and `ListingClosed` (unpublish).

## Routes and screens

`/app/settings/emails` and `/app/settings/emails/<key>` (reached from the Emails button on the F02 Settings page), `/webhooks/ses`. The photo upload routes (`/apps/classifieds/upload-url`, `/apps/classifieds/upload-complete`) are added by F04 on top of `media.createUploadUrl()` and `media.completeUpload()`, because they need the seller sign-in

## Business rules

- Shopify email can’t be used: the app sends its own email through SES (two config sets: `transactional`, `alerts`).
- Staff notices are immediate, go to `EmailSettings.staffNotify` with the listing title and review link, and are separate from the subscriber digest.
- Every email goes through the outbox: suppression check, one try at once, then hourly retries for about a day. Emails that carry a code or private link are never stored; they are retried on the spot only.
- Every email the app sends, to staff and to sellers, has a template in the registry that staff can edit in Settings → Emails. A new email is added with `/add-email-template`, never as wording in code.
- Required placeholders can’t be removed; alert emails always carry the unsubscribe link and postal address.
- Only a hash of each seller link is stored, so a seller link in an email is optional. Seller emails that point back to the listing page show “Can’t find your private link? Get it here” with the Get my link page (`get_link_url`, F04-T3); `seller_link_request` sends a seller fresh links for all their open listings (F03-T4).
- Photos are never stored in Shopify Files: `incoming/` → `private/` → `public/` (CloudFront OAC only); EXIF/GPS stripped; max 12 (from settings). A deleted photo is removed from storage at once; photos of a closed listing are removed after the retention period (90 days).
- Only photos staff approved go public (`Photo.approvedAt`, from the `photoIds` on `ListingApproved` / `RevisionApproved`). A closed listing publishes nothing, and an hourly sweep (`media.unpublish-closed`) takes down any closed listing whose public photos are still up.

## Tickets

| Ticket                            | Title                                                         | Status |
| --------------------------------- | ------------------------------------------------------------- | ------ |
| [F03-T1](tickets/F03-T1.md)       | Email engine                                                  | Done   |
| [F03-T2](tickets/F03-T2.md)       | Photo storage                                                 | Done   |
| [F03-T3](tickets/F03-T3.md)       | Email settings screens                                        | Done   |
| [F03-T4](tickets/F03-T4.md)       | Seller link help in emails                                    | Done   |
| [F03-FIX-1](tickets/F03-FIX-1.md) | A repeated upload completion must not delete the stored photo | Done   |
| [F03-FIX-2](tickets/F03-FIX-2.md) | Only approved photos may be published                         | Done   |
| [F03-FIX-3](tickets/F03-FIX-3.md) | Render a copy-only email template                             | Done   |
| [F03-FIX-4](tickets/F03-FIX-4.md) | Refuse photo uploads to a closed unused invitation            | Done   |
| [F03-FIX-5](tickets/F03-FIX-5.md) | notifications.getEmailStatuses(keys) for batches              | To do  |
