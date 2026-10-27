# F08-FIX-8 — Privacy erase: held and live messages, listing data, suppression, shop redact

|                     |                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| **Status**          | To do                                                                                                    |
| **Feature**         | [F08 Operations and launch](../README.md)                                                                |
| **Module(s)**       | `ops`, plus `contact`, `access`, `workspace`, `notifications`, `platform` (cross-module, needs approval) |
| **Security skills** | `security-operations`, `security-contact`, `security-access`, `security-notifications`                   |

Start with `/implement-ticket F08-FIX-8`. Raised by [review 8](../../../reviews/2026-10-27-review-8.md) (Medium ×5 and related Lows). Follows [F08-T5](F08-T5.md).

## Problem

- **Held messages** (`contact/services/erase.js`, `messages.js:177`): an erased HELD message can be released; it goes out with an empty reply-to, so SES uses OCP support's address.
- **Live listings** (`access/services/erase.js:29-31`, `contact/services/messages.js:101-105`): an erased seller's LIVE listing still takes buyer messages; the send to `redacted+<id>@invalid` throws `ValidationError`, the row stays DELIVERED with the buyer's data, and the buyer sees an error.
- **Listing data** (`ops/services/erase.js:57-64`): `Listing.sellerDisplay`, `city`, `state`, `ListingRevision.changes` and the live storefront entry keep the seller's data.
- **Suppression** (`notifications/services/erase.js:13-18`): erasing an address drops its suppression, so a bounced or complained address can be emailed again.
- **Shop redact** (`ops/services/erase.js:74-83`): `eraseShop()` does table-wide work inside the webhook request (Shopify's 5 s).

## Scope

- [ ] contact: `release()` / `relay()` refuse a message with no buyer email (nothing is sent, staff see "erased"); notifications `send()` requires a reply-to for `buyer_message`. Erased HELD messages stay HELD (F08-T5 decision) unless the plan shows DISCARDED is simpler (ask the user).
- [ ] contact: a `ValidationError` from `send()` in `relay()` counts as FAILED, so the buyer's row is deleted as for any failed send; an erased seller (`@invalid`) is treated as unreachable.
- [ ] Seller listing data: on `customers/redact` for a seller, close each open listing through core `transition()` (a new close reason or REMOVED, per the plan; publishing retires the page as for any close) and blank `sellerDisplay`, `city`, `state` and the matching `ListingRevision.changes` keys through workspace's `index.js`. Confirm the client default in F08-T5 Notes first.
- [ ] notifications: keep a non-reversible suppression marker (`sha256(email + TOKEN_PEPPER)`) when an address is erased, and have `isSuppressed()` check it (schema change: `/schema-change`).
- [ ] `shop/redact`: acknowledge, record a job keyed by the webhook id, and run `eraseShop()` from the scheduler (sessions deleted after it succeeds); or record a DECISION with timings showing it fits in 5 s at OCP's size.
- [ ] Lows: platform throws for a redact topic with no handler registered; the platform audit row is written after the handler succeeds; access blanks `Invitation.itemSummary` (or a DECISION); `access.getSellerContacts()` leaves out redacted invitations so ops stops retrying `@invalid` addresses; notifications erase skips rows in SENDING (or `finish()` tolerates a missing row); the `PrivacyRequest` typedef is exported from `platform/index.js`.
- [ ] Docs: `docs/architecture/shopify-config.md:41` and the `operations.md` retention table describe the erasure; module `CLAUDE.md` files.

## Out of scope

- The records purge (F08-FIX-7).

## Acceptance criteria

- [ ] Erase then release of a HELD message sends nothing and changes nothing else (test).
- [ ] A buyer message to an erased seller's listing is refused or fails cleanly and leaves no stored buyer data (test).
- [ ] After a seller's `customers/redact`, their open listings are closed through `transition()` and hold no seller display name or location (test).
- [ ] An erased address that was suppressed is still suppressed for a new send (test).
- [ ] `shop/redact` answers within the webhook budget and the erasure completes (test).
- [ ] `npm run test:ai` is green for every touched module.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._
