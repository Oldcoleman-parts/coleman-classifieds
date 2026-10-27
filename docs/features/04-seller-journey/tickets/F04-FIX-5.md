# F04-FIX-5 — Earlier listings panel clears with the email

|                     |                                    |
| ------------------- | ---------------------------------- |
| **Status**          | Done                               |
| **Feature**         | [F04 Seller journey](../README.md) |
| **Module(s)**       | `access` (route only)              |
| **Security skills** | `security-access`                  |

Start with `/implement-ticket F04-FIX-5`. Raised by [review 5](../../../reviews/2026-10-27-review-5.md) (Medium, F04 fixes): on New invitation (`app/routes/app.invitations.new.jsx:59-60`), clearing the email field returns early from `lookUp`, so `lookedUp` and the fetcher's data keep the previous email and the panel still shows "N earlier listings for old@…" next to an empty field.

## Scope

- [x] An empty email resets the panel: `setLookedUp("")`, and the panel ignores the fetcher's rows while `lookedUp` is empty ("Enter the seller's email…").
- [x] The rows shown always belong to the email named above them (no stale rows from an earlier lookup).
- [x] Review 5 Lows on the same screen, as they are a few lines each: skip a second load when the trimmed email equals `lookedUp` (blur then button click); call `statusBadge(row.status)` once per row.

## Out of scope

- The invalid-email message and the GET `?email=` query string (review 5 Lows; stay in the checklist).

## Acceptance criteria

- [x] Manual QA on the dev store, recorded under Notes: look up an email with earlier listings, clear the field (blur) → the panel shows the empty prompt, not the old rows; enter another email → only its rows.
- [x] `npm run test:ai -- app/modules/access` is green.

## Notes

- `loadCreateInvitationScreen()` returns `historyEmail` (the normalised email the rows belong to, or null); the screen shows fetcher rows only when it matches `lookedUp`, ignoring case (`// DECISION:`), and drops the `screen.history` fallback (always `[]` without `?email=`). An empty email sets `lookedUp` to `""` (the prompt shows). A load is skipped when the trimmed email equals `lookedUp` and is loading or loaded; a failed load can be retried. `statusBadge()` is called once per row.
- Tests: `access/tests/screens.test.js` (`historyEmail` null without or with an invalid email, lowercased in any case). `npm run test:ai -- app/modules/access` → `✓ 145 passed · 0 failed`.
- Manual QA on the dev store (2026-10-27, passed, reported by the user): an email with an earlier listing shows its rows; clearing the field (blur) shows the empty prompt, not the old rows; another email shows only its own result; the same email in another case shows the same rows; blur then the button sends one request; badges show the right label and tone.
- 2026-10-27: status set back to To do so F08-FIX-4 can be worked on (the tracker allows one ticket In progress). The code is committed (`25336f8`); only the dev-store QA above remains.
- `npm run test:ai` (full suite, review 6, at `25336f8`) → `✓ 1117 passed · 0 failed · 1 skipped`, including `app/modules/access`.
