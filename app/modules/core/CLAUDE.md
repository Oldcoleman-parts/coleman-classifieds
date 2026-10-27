# Module `core` — part of F01 Foundation and platform

Project setup, hosting, the Shopify platform layer, the full database schema and the core listing lifecycle that every other feature uses.

- **Spec and tickets:** `docs/features/01-foundation/`
- **Security skill:** `security-core` (loads automatically when you edit this module; audits are on demand).
- **Events:** Defines the event bus and every event in `docs/architecture/events.md`; publishes lifecycle events from `transition()`.

## Rules for this feature

- State changes only through `transition()`. Invalid transitions throw.
- The audit log is append-only (DB trigger); only the retention purge role can delete.
- Flags are read through `flags.isEnabled()`; release gates come from env (`RENEWALS_RELEASED`, `OPEN_SUBMISSIONS_RELEASED`).
- Month maths uses `addMonths` in the shop timezone. Time adjustments only go through `adjustTime()`.
- A handler failure is logged and swallowed, except for the events in `MUST_SUCCEED` (`events.js`, today only `PaymentReceived`): there `publish()` rejects, so the payments apply step leaves appliedAt empty and its task retries (F01-FIX-1).
- `runOutsideEvents(fn)` (F01-FIX-9) runs detached work started inside a handler outside the current event queue, so the events it publishes are dispatched at once instead of queued (used by payments `services/apply.js`).
- `payment.js` `applyPayment()` is the `PaymentReceived` listener. It throws only for a temporary failure. A payment that can never be applied sets `refundFlag` and writes a `PaymentNotApplied` audit entry; it never writes `status`.
- Other modules write an event inside their own transaction with `recordEvent(tx, …)` and call `dispatch()` after the commit (F01-FIX-4). Form money helpers `dollarsToCents()` / `centsToDollars()` are in `validators.js` (integer maths).
- `closeUnusedListing(listingId, reason, actor, { tx })` (F01-FIX-3) closes the record of an INVITED listing whose invitation expired (SYSTEM) or was revoked (STAFF): `closedAt`, `closedReason` (`INVITATION_EXPIRED` / `INVITATION_REVOKED`), `purgeAfter`, one audit entry, no status change and no event. Repeats change nothing; `transition()` refuses a closed INVITED record.
- F01-FIX-6: `SUBMIT` rules have a guard (with a `refusal` message): refused once `draftDueBy` / `correctionDueBy` has passed. `transition(…, { beforeCommit(tx, listing) })` runs the hook after the update and audit row, inside the transaction; a throw rolls all back and sends no event. `getChangesRequestNote(listingId)` (`listings.js`) reads the latest `ChangesRequested` note from the audit log, or null.
- F01-FIX-10: other modules read the audit log only through `countAuditEntries({ action, listingIds, since })` (`Map<listingId, count>`) and `listingsWithAuditEntry(...)` (`Set<listingId>`) in `audit.js`: at most 500 ids a call, one groupBy, ids and counts only (never `details` or the actor). Invalid input is a `ValidationError`.
- F08-T4: `purge.js` `runAsPurgeRole(fn)` runs one transaction as `classifieds_purge` (30 s timeout). With its `tx`: `lockPurgeableListing()` (`FOR UPDATE`, closed, `purgeAfter` passed, no `metaobjectGid`, else null), `purgeListingAudit()`, `purgeListingCore()` (time adjustments, then the listing), `purgeExpiredAuditEntries(tx, { keepRulesVersions })` (listing-less rows past retention, keeping `SettingsUpdated` rows of the current or a referenced rules version, 5000 a call). F08-FIX-7: both compare with the database's `now()` (UTC) as the trigger does, with no `now` option; rules versions are plain strings. The trigger (migration `audit_purge_past_retention`) lets the purge role delete an audit row only past retention: a listing's once its `purgeAfter` has passed, a listing-less one once older than `recordsRetentionDays`.

## Boundaries

- Export only through `index.js`. Never import other modules’ `services/`; use their `index.js` or events.
- Status changes go through `core` `transition()`.
