# F04-FIX-4 — access.getSellerContacts() for other modules

|                     |                                    |
| ------------------- | ---------------------------------- |
| **Status**          | Done                               |
| **Feature**         | [F04 Seller journey](../README.md) |
| **Module(s)**       | `access`                           |
| **Security skills** | `security-access`                  |

Start with `/implement-ticket F04-FIX-4`. Raised by [review 5](../../../reviews/2026-10-27-review-5.md) (Medium, F08): `ops/services/facts.js:20-46` reads `invitation.sellerEmail` and `sellerName` through the `Listing` relation, which queries a table that `access` owns. The `// DECISION:` there cites payments and publishing doing the same. Access should offer the read, so ops can switch to it in [F08-FIX-3](../../08-operations-and-launch/tickets/F08-FIX-3.md).

## Scope

- [x] Export `getSellerContacts(listingIds)` from `app/modules/access/index.js`: returns a `Map` of listing id → `{ sellerEmail, sellerName }` (one query for a batch, so a job of 200 listings stays one round trip). Unknown ids are left out. JSDoc `@param` / `@returns`, and the return value is documented as never public.
- [x] Note the function in `app/modules/access/CLAUDE.md`, as the only way other modules read a seller's contact details.

## Out of scope

- Switching ops to it ([F08-FIX-3](../../08-operations-and-launch/tickets/F08-FIX-3.md)).
- Payments and publishing reads of the same relation: list them under Notes as follow-ups if found, but don't change them here.

## Acceptance criteria

- [x] `getSellerContacts([a, b, unknown])` returns the contacts of `a` and `b` only (test).
- [x] `npm run test:ai -- app/modules/access` is green (144 passed).

## Notes

- `// DECISION:` at most 500 ids per call (`requireIdList`, duplicates dropped), so a job batch of 200 listings is one call. The query reads `Listing` with a `select` on its invitation (the foreign key is `Listing.invitationId`), so the token hash and phone are never read.
- Follow-ups (not changed here): other modules still read `listing.invitation.sellerEmail` / `sellerName` through the relation. Each could switch to `getSellerContacts()` in its own fix ticket:
  - publishing (F06): `services/emails.js`, `services/facts.js:53`
  - payments (F06): `services/checkout.js:113`, `services/approval.js`, `services/facts.js:29`
  - contact (F07): `services/facts.js:45`
  - console (F05): `services/review.js`, `services/seller-email.js`, `services/listing-list.js` (also searches by seller name and email), `services/review-actions.js`
  - ops (F08): `services/facts.js:28`, already [F08-FIX-3](../../08-operations-and-launch/tickets/F08-FIX-3.md)
  - workspace gets the invitation from the access gate, so it needs no change.
