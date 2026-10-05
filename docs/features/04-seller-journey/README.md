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

Publishes `InvitationCreated`. Triggers `ListingSubmitted` (NEW / CORRECTED), `RevisionSubmitted` and `ListingUpdatedImmediate`. Listens to `ListingClosed` and `ListingRejected` to close the link.

## Routes and screens

`/app/invitations/new`, `/apps/classifieds/seller/:token` (+ draft, submit, live actions)

## Business rules

- Token: 32 random bytes, stored only as `sha256(token+PEPPER)`; one listing per invitation (DB unique constraint).
- Fee and offer scope (FIRST_MONTH / ALL_RENEWALS) are locked at creation; unused invitations expire after 30 days.
- Rules shown to sellers: lanterns and stoves of any brand; accessories and manuals only with equipment; no separate parts or documentation. The agreement box is **unticked by default**, and the version, date and time are recorded.
- Drafts: 14 days from start; corrections: 14 days. Live: price, quantity, availability note and photo removal are immediate; title, description and photo additions create a revision. No adding or replacing merchandise.

## Tickets

| Ticket                      | Title                          | Status |
| --------------------------- | ------------------------------ | ------ |
| [F04-T1](tickets/F04-T1.md) | Invitations and private access | To do  |
| [F04-T2](tickets/F04-T2.md) | Seller listing page            | To do  |
