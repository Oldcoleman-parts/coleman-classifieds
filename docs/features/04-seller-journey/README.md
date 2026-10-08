# F04 — Seller journey

|                     |                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Phase**           | 1                                                                                                                      |
| **Module(s)**       | `app/modules/access/`, `app/modules/workspace/`                                                                        |
| **Depends on**      | 01, 03                                                                                                                 |
| **Estimate**        | ~4 days                                                                                                                |
| **Security skills** | `security-access`, `security-workspace` (guide coding automatically; audits run on demand with `/security-review F04`) |

## Purpose

Everything the seller does: the private one-listing invitation and the seller page where they prepare, submit, correct and manage their listing.

## Owns data

`Invitation`, `EmailCode`, `Listing` (content fields), `ListingRevision`, `TermsAcceptance` (definitions in `docs/architecture/data-model.md`)

## Events

Publishes `InvitationCreated`. Triggers `ListingSubmitted` (NEW / CORRECTED), `RevisionSubmitted` and `ListingUpdatedImmediate`. Listens to `ListingClosed` and `ListingRejected` to close the link (access), and to `RevisionApproved` / `RevisionRejected` to apply staff decisions to the listing (workspace).

## Routes and screens

`/app/invitations/new`, `/app/invitations/:id` (view, revoke, staff photos; `/app/invitations/:id/photos` is its JSON upload helper), `/apps/classifieds/seller/:token` (GET, and POST to resume with a device credential), `/apps/classifieds/seller/:token/code-request` and `/code-verify` (F04-T1); POST `/start`, `/draft`, `/submit`, `/live`, `/revision`, `/sold`, `/remove` (pages) and `/upload-url`, `/upload-complete`, `/photo-delete`, `/photo-order` (JSON for the page script), all under `/apps/classifieds/seller/:token` (F04-T2); `/apps/classifieds/my-link` (GET form, POST: email new links for the open listings, F04-T3)

Every storefront page above is a standalone document outside the theme (`layout: false`, F04-FIX-2), styled to match the store, with the logo from Settings → Emails. Token pages load no script, stylesheet or font from another origin.

## Business rules

- Token: 32 random bytes, stored only as `sha256(token+PEPPER)`; one listing per invitation (DB unique constraint).
- Fee and offer scope (FIRST_MONTH / ALL_RENEWALS) are locked at creation; unused invitations expire after 30 days.
- Rules shown to sellers: lanterns and stoves of any brand; accessories and manuals only with equipment; no separate parts or documentation. The agreement box is **unticked by default**, and the version, date and time are recorded.
- Drafts: 14 days from start; corrections: 14 days. Live: price, quantity, availability note and photo removal are immediate; title, description and photo additions create a revision. No adding or replacing merchandise.

## Tickets

| Ticket                            | Title                                           | Status |
| --------------------------------- | ----------------------------------------------- | ------ |
| [F04-T1](tickets/F04-T1.md)       | Invitations and private access                  | Done   |
| [F04-T2](tickets/F04-T2.md)       | Seller listing page                             | Done   |
| [F04-T3](tickets/F04-T3.md)       | Get my link                                     | Done   |
| [F04-FIX-1](tickets/F04-FIX-1.md) | Apply staff decisions on a revision             | Done   |
| [F04-FIX-2](tickets/F04-FIX-2.md) | Seller pages render outside the theme           | Done   |
| [F04-FIX-3](tickets/F04-FIX-3.md) | Email the invitation automatically, with resend | To do  |
