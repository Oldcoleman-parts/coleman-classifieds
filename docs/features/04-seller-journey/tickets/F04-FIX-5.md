# F04-FIX-5 — Earlier listings panel clears with the email

|                     |                                    |
| ------------------- | ---------------------------------- |
| **Status**          | To do                              |
| **Feature**         | [F04 Seller journey](../README.md) |
| **Module(s)**       | `access` (route only)              |
| **Security skills** | `security-access`                  |

Start with `/implement-ticket F04-FIX-5`. Raised by [review 5](../../../reviews/2026-10-27-review-5.md) (Medium, F04 fixes): on New invitation (`app/routes/app.invitations.new.jsx:59-60`), clearing the email field returns early from `lookUp`, so `lookedUp` and the fetcher's data keep the previous email and the panel still shows "N earlier listings for old@…" next to an empty field.

## Scope

- [ ] An empty email resets the panel: `setLookedUp("")`, and the panel ignores the fetcher's rows while `lookedUp` is empty ("Enter the seller's email…").
- [ ] The rows shown always belong to the email named above them (no stale rows from an earlier lookup).
- [ ] Review 5 Lows on the same screen, as they are a few lines each: skip a second load when the trimmed email equals `lookedUp` (blur then button click); call `statusBadge(row.status)` once per row.

## Out of scope

- The invalid-email message and the GET `?email=` query string (review 5 Lows; stay in the checklist).

## Acceptance criteria

- [ ] Manual QA on the dev store, recorded under Notes: look up an email with earlier listings, clear the field (blur) → the panel shows the empty prompt, not the old rows; enter another email → only its rows.
- [ ] `npm run test:ai -- app/modules/access` is green.

## Notes
