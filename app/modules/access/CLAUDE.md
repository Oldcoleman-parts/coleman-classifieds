# Module `access` — part of F03 Seller journey

Everything the seller does: the private one-listing invitation and the seller page where they prepare, submit, correct and manage their listing.

- **Spec and tickets:** `docs/features/03-seller-journey/`
- **Security skill:** `security-access` (loads automatically when you edit this module; audits are on demand).
- **Events:** Publishes `InvitationCreated`. Triggers `ListingSubmitted` (NEW / CORRECTED), `RevisionSubmitted` and `ListingUpdatedImmediate`. Listens to `ListingClosed` and `ListingRejected` to close the link.

## Rules for this feature

- Token: 32 random bytes, stored only as `sha256(token+PEPPER)`; one listing per invitation (DB unique constraint).
- Fee and offer scope (FIRST_MONTH / ALL_RENEWALS) are locked at creation; unused invitations expire after 30 days.
- Rules shown to sellers: lanterns and stoves of any brand; accessories and manuals only with equipment; no separate parts or documentation. The agreement box is **unticked by default**, and the version, date and time are recorded.
- Drafts: 14 days from start; corrections: 14 days. Live: price, quantity, availability note and photo removal are immediate; title, description and photo additions create a revision. No adding or replacing merchandise.

## Boundaries

- Export only through `index.ts`. Never import other modules’ `services/`; use their `index.ts` or events.
- Status changes go through `core` `transition()`.
