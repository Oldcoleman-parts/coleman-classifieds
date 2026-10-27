# Module `ops` — part of F08 Operations and launch

Make every time-based rule run on its own, keep data only as long as agreed, back everything up, alert people when something breaks, and launch.

- **Spec and tickets:** `docs/features/08-operations-and-launch/`
- **Security skill:** `security-operations` (loads automatically when you edit this module; audits are on demand).
- **Events:** Triggers `ListingClosed` (EXPIRED, LAPSED); publishes `IncidentRaised`.

## Rules for this feature

- Tasks are isolated, idempotent and time-boxed; a task failing twice → JOB incident; a watchdog alerts if there’s been no run for 3 hours or more.
- Retention: private photos 90 days after close; payment, agreement, history, messages and contact details 1 year after close (`purgeAfter`).
- Backups: Railway daily + a nightly encrypted `pg_dump` to OCP’s S3 (SSE-KMS).

## How it is built (F08-T1)

- `ops.register()` comes last in bootstrap: the `ListingClosed` listener and the hourly tasks `ops.expire-drafts`, `ops.expire-corrections`, `ops.expire-month`, `ops.draft-reminders`, `ops.expiry-reminders`, `ops.closed-emails`, `ops.retire-pages`, plus the flag-gated hooks `renewals.grace-expiry`, `renewals.reminders` and `open-submissions.unverified` (they return `{ skipped: "flag-off" }`).
- Deadlines only offer due listings to core `transition(EXPIRE)`; core's guards decide. `InvalidTransitionError` means the listing moved on (counted as `skipped`).
- Reminders (`draft_reminder`, `expiry_reminder`) are sensitive: up to 3 tries an hour apart, keyed `<template>:<listingId>:<deadline ms>:<k>`, as publishing's `listing_live`. They link Get my link, never the private seller link.
- `services/facts.js` is the only file that reads `Listing`, and only its own fields; ops writes no listing fields. The seller's email and name come from `access.getSellerContacts()`, one call per batch; a listing with no contact is skipped and logged by id only (F08-FIX-3). Page retirement calls `publishing.retireListing()` `photoRetentionDays` after close, 20 a run.
- Outside a request Shopify is reached with `offlineAdmin()`; tests use `setOfflineAdmin()`.
- The records purge is F08-T4 and the privacy erasure F08-T5.

## Boundaries

- Export only through `index.js`. Never import other modules’ `services/`; use their `index.js` or events.
- Status changes go through `core` `transition()`.
