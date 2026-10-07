# Module `workspace` — part of F04 Seller journey

Everything the seller does: the private one-listing invitation and the seller page where they prepare, submit, correct and manage their listing.

- **Spec and tickets:** `docs/features/04-seller-journey/`
- **Security skill:** `security-workspace` (loads automatically when you edit this module; audits are on demand).
- **Events:** Triggers `ListingSubmitted` (NEW / CORRECTED), `RevisionSubmitted` and `ListingUpdatedImmediate`. Listens to `RevisionApproved` and `RevisionRejected` (F04-FIX-1).

## Rules for this feature

- Token: 32 random bytes, stored only as `sha256(token+PEPPER)`; one listing per invitation (DB unique constraint).
- Fee and offer scope (FIRST_MONTH / ALL_RENEWALS) are locked at creation; unused invitations expire after 30 days.
- Rules shown to sellers: lanterns and stoves of any brand; accessories and manuals only with equipment; no separate parts or documentation. The agreement box is **unticked by default**, and the version, date and time are recorded.
- Drafts: 14 days from start; corrections: 14 days. Live: price, quantity, availability note and photo removal are immediate; title, description and photo additions create a revision. No adding or replacing merchandise.

## How it is built (F04-T2)

- Routes `proxy.seller.$token*.jsx` call `workspace/index.js` only. Every handler (`services/handlers.js`) goes through access’s `gateSeller()`: rate limits, `resolveToken()` (with the draft and correction deadlines), the device credential, and for POSTs the signed form token (`csrf` field or `X-CC-Form`). Then it checks the listing status on the server.
- `services/fields.js` holds the field rules (plain text, no `<`/`>`, length limits, price in dollars → cents). The seller name is a choice; the server writes the first name or “Private seller”.
- `services/draft.js`: “Start my listing” (INVITED → DRAFT, link USED), draft save (`updateMany` only while DRAFT/CHANGES_REQUESTED), submit (complete listing + current rules version + ticked box → `TermsAcceptance`, then `SUBMIT`).
- `services/live.js`: immediate price/quantity/note (`ListingUpdatedImmediate`), title/description/new photos as one PENDING `ListingRevision` (`RevisionSubmitted`), sold/remove after a confirmation page.
- `services/photos.js`: which status may add, remove or reorder photos; media trusts the listing id it gets, so the checks are here. Photos added while LIVE stay unapproved until a revision is approved.
- `services/views.js` renders the Liquid page through access’s `sellerLayout()` (a standalone document outside the theme, F04-FIX-2); `services/page-script.js` is the inline script (autosave, uploads with `media/client.js`), kept inside `{% raw %}`.
- `events.js` + `services/revisions.js` (F04-FIX-1): an approved revision’s title/description are re-checked (`cleanRevisionChanges`) and copied into the listing; a rejected one’s never-approved photos are deleted with the staff member as actor. Only a PENDING revision of that listing is decided. `register()` is called from `app/bootstrap.server.js` after media and **before publishing (F06)**.
- Tests: photo fixtures need media’s id format (24 hex characters; `tests/helpers.js` does this).
- Not yet: the staff note and an atomic agreement + submit (F01-FIX-6).

## Boundaries

- Export only through `index.js`. Never import other modules’ `services/`; use their `index.js` or events.
- Status changes go through `core` `transition()`.
