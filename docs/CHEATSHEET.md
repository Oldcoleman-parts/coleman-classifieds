# Coleman Classifieds — cheat sheet

## First time (existing `shopify app init` app)

1. Copy the structure into the app (see README) and commit.
2. `claude` → `/baseline-sync 01` (read-only: what the template already covers)
3. `/start-feature 01` → `/implement-ticket F01-T1` (adapts the template; never re-scaffolds)

## Lost?

`/next` (what to run now) · `/progress` · `/progress 06` · `/progress payments`
The status line always shows: launch tickets done · open fixes or unreviewed features · current ticket.

## Build loop (every ticket)

| Step | Where    | Command                                                                                 |
| ---- | -------- | --------------------------------------------------------------------------------------- |
| 1    | terminal | Stay on your working branch (e.g. `develop`). Ticket branches are optional              |
| 2    | terminal | `claude` (a progress summary prints)                                                    |
| 3    | Claude   | `/start-feature 04`                                                                     |
| 4    | Claude   | `/implement-ticket F04-T1` → **approve the plan** → build → tests → try it              |
| 5    | Claude   | `/close-ticket F04-T1`                                                                  |
| 6    | terminal | `git add -A && git commit -m "feat(access): … (F04-T1)"` (always include the ticket ID) |
| 7    | Claude   | `/compact` (or start a fresh session)                                                   |

## Reviews (whenever you choose)

| Command                            | What it does                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/review-all`                      | Code + security for everything since the last checkpoint. Saves a report, creates fix tickets, sets a checkpoint |
| `/review-all F04 F05`              | The same, for specific features                                                                                  |
| `/code-review [F..]`               | Code review only                                                                                                 |
| `/security-review [F.. or module]` | Security audit only (uses the module security skills)                                                            |
| `/implement-ticket F04-FIX-1`      | Fix a review finding                                                                                             |

Suggested rhythm: after F01–F03 · after F04–F06 (before the client demo) · after F07+F08 (**required before launch**).

## Tests (token-light)

- `npm run test:ai -- --changed` while building, `npm run test:ai -- app/modules/<m>` at close, `npm run test:ai` for reviews.
- `npm test` gives the full output (for you, not Claude).

## Other commands

`/schema-change` · `/new-module <name>` · `/add-webhook orders/paid` · `/add-email-template <key>` · `/shopify-graphql` · `/dev-store-qa F06-T1` · `/dev-store-qa e2e` · `/ops-runbook check-backups|restore-staging|reconcile|incidents`

## Milestones

- **After F06:** `/dev-store-qa e2e` (steps 1–6, 11) on staging, then the client demo.
- **Launch (F08-T2):**
  - `/review-all` covers every launch feature, with no open Critical or High findings;
  - the full e2e passes on staging;
  - the restore test passes;
  - the client signs off;
  - a human deploys;
  - the theme blocks and header button are installed;
  - the staff notification address is set;
  - the first invitation is sent.

## Git: one branch

- Work on one branch, for example `develop`, and keep `main` as the last approved or deployed version.
- Only one ticket at a time is `In progress`. The tracker uses that to know the current ticket.
- Commit at the end of every ticket with the ID in the message, so it’s easy to find later: `git log --oneline --grep F04-T1`.
- To undo a ticket: `git revert <commit>`. Reviews still use `review-N` tags as checkpoints.
- Ticket branches (`f04-t1-…`) remain optional, for example to try something risky.
