# F08-FIX-3 — Ops reads seller contacts through access

|                     |                                           |
| ------------------- | ----------------------------------------- |
| **Status**          | To do                                     |
| **Feature**         | [F08 Operations and launch](../README.md) |
| **Module(s)**       | `ops`                                     |
| **Security skills** | `security-operations`                     |

Start with `/implement-ticket F08-FIX-3`. **Prerequisite:** [F04-FIX-4](../../04-seller-journey/tickets/F04-FIX-4.md). Raised by [review 5](../../../reviews/2026-10-27-review-5.md) (Medium, F08): `ops/services/facts.js:20-46` selects `invitation.sellerEmail` and `sellerName` through the `Listing` relation, querying a table that `access` owns.

## Scope

- [ ] Drop `invitation` from `facts.js` `SELECT`; reminders, closed emails and hooks get the contact from `access.getSellerContacts(ids)` (one call per batch). A listing with no contact is skipped and logged by id.
- [ ] Remove the `// DECISION:` that cites payments and publishing; update the `OpsListing` typedef and `app/modules/ops/CLAUDE.md`.

## Out of scope

- Payments and publishing reads of the same relation.

## Acceptance criteria

- [ ] The existing reminder and closed-email tests pass unchanged, and no `ops` file selects `invitation` (grep check recorded under Notes).
- [ ] `npm run test:ai -- app/modules/ops` is green.

## Notes
