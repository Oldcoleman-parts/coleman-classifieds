# F08-FIX-3 — Ops reads seller contacts through access

|                     |                                           |
| ------------------- | ----------------------------------------- |
| **Status**          | Done                                      |
| **Feature**         | [F08 Operations and launch](../README.md) |
| **Module(s)**       | `ops`                                     |
| **Security skills** | `security-operations`                     |

Start with `/implement-ticket F08-FIX-3`. **Prerequisite:** [F04-FIX-4](../../04-seller-journey/tickets/F04-FIX-4.md). Raised by [review 5](../../../reviews/2026-10-27-review-5.md) (Medium, F08): `ops/services/facts.js:20-46` selects `invitation.sellerEmail` and `sellerName` through the `Listing` relation, querying a table that `access` owns.

## Scope

- [x] Drop `invitation` from `facts.js` `SELECT`; reminders, closed emails and hooks get the contact from `access.getSellerContacts(ids)` (one call per batch). A listing with no contact is skipped and logged by id.
- [x] Remove the `// DECISION:` that cites payments and publishing; update the `OpsListing` typedef and `app/modules/ops/CLAUDE.md`.

## Out of scope

- Payments and publishing reads of the same relation.

## Acceptance criteria

- [x] The existing reminder and closed-email tests pass unchanged, and no `ops` file selects `invitation` (grep check recorded under Notes).
- [x] `npm run test:ai -- app/modules/ops` is green.

## Notes

- Grep check: `grep -rn invitation app/modules/ops --include=*.js --exclude-dir=tests` returns nothing. `reminders.test.js` and `closed.test.js` are unchanged and pass (22 ops tests, including the new `tests/contacts.test.js`).
- DECISION: a listing with no contact counts in the existing `failed` (reminders) or `errors` (closed emails) field, so the summary shapes stay the same. It is logged as `[ops] <template> skipped for <id>: no-contact`, with the id only.
- `getSellerContacts` is called once per batch, outside the per-listing try, so a failed lookup fails the task and the scheduler's retry and incident rules apply. The `ListingClosed` listener looks up its one listing.
- A missing contact can't happen today (`Listing.invitationId` is required); the guard is for a race or the F08-T5 erasure.
