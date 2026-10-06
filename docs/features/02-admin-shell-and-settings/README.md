# F02 — Admin shell and settings

|                     |                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Phase**           | 1                                                                                                                  |
| **Module(s)**       | `app/modules/console/`, `app/modules/core/` (settings writer only)                                                 |
| **Depends on**      | 01                                                                                                                 |
| **Estimate**        | ~1.5 days                                                                                                          |
| **Security skills** | `security-console`, `security-core` (guide coding automatically; audits run on demand with `/security-review F02`) |

## Purpose

The first staff screens inside Shopify admin: the app navigation, a home page, and the Settings screens where staff set fees, time limits, the photo limit, the listing rules, held-message rules and the feature switches. Later features read these values and add their own screens to the same navigation.

## Owns data

Writes `Settings` through `core.updateSettings()` and `core.setFlag()` (core owns the table; definitions in `docs/architecture/data-model.md`).

## Events

`FeatureToggled` (published by core when staff switch a feature). Settings saves write an `AuditEvent` and publish no event.

## Routes and screens

`/app` (home, empty state until F05), `/app/settings`, `/app/settings/features`

## Business rules

- Polaris only; App Bridge for navigation, toasts, the save bar and modals.
- Every save is audited with the staff email and the changed fields.
- Numbers are bounded (fees ≥ 0, windows 1–60 days, photo limit 1–12); out-of-range values are rejected with a field error.
- A promotional fee can’t be above the base fee. Held-message rules: up to 50 flagged words (60 characters each), repeated sends 1–20.
- Admin screens use online sessions (`useOnlineTokens`), so every action knows the staff email; `core.staffFromSession()` reads it.
- Editing the rules text bumps `rulesVersion`; a save that leaves the text unchanged doesn’t.
- Features card: the alerts switch is visible at launch; renewals and open submissions appear only when released. Turning a feature off needs a confirmation modal.
- The navigation shows only screens that exist. F03 adds Settings → Emails; F05 adds listings, messages, history and health.

## Tickets

| Ticket                      | Title                            | Status |
| --------------------------- | -------------------------------- | ------ |
| [F02-T1](tickets/F02-T1.md) | Admin shell and settings         | Done   |
| [F02-T2](tickets/F02-T2.md) | Listing rules and feature switch | Done   |
