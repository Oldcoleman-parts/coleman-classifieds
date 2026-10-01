# F09 — Open submissions

|                     |                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Phase**           | Later                                                                                                      |
| **Module(s)**       | `app/modules/access/public/`                                                                               |
| **Depends on**      | 03, 04                                                                                                     |
| **Estimate**        | ~1.5 days                                                                                                  |
| **Security skills** | `security-open-submissions` (guide coding automatically; audits run on demand with `/security-review F09`) |

## Purpose

Sellers request a listing without an invitation; staff approval is still required.

## Owns data

`Invitation.source = PUBLIC_SUBMISSION` (definitions in `docs/architecture/data-model.md`)

## Events

Existing events; listens to `FeatureToggled`.

## Routes and screens

`/apps/classifieds/submit`, `/apps/classifieds/submit/verify`

## Business rules

- 404 unless released and enabled; email verification; one open listing per email; Turnstile and rate limits; standard or promo fee only.

## Tickets

| Ticket                      | Title                  | Status |
| --------------------------- | ---------------------- | ------ |
| [F09-T1](tickets/F09-T1.md) | Public submission flow | To do  |
