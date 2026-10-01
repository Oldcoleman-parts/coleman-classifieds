@AGENTS.md

## Lost? `/next` tells you what to run; `/progress [feature]` shows what’s done, what’s left and what’s unreviewed. See `docs/CHEATSHEET.md`.

## Build loop (fast: no reviews inside it)

1. `git checkout -b f03-t1-invitations`
2. `/start-feature 03`
3. `/implement-ticket F03-T1`:
   - plan with `feature-planner` → **wait for approval** → build;
   - tests via `test-writer` (compact `test:ai` on changed files) → try it.
4. `/close-ticket F03-T1`, then commit and merge, then `/compact`.

## Reviews (on demand, e.g. after 2–3 features)

- `/review-all` covers code + security for everything since the last checkpoint. It writes a report to `docs/reviews/`, creates fix tickets and sets a checkpoint.
- `/code-review [F03 F04]` and `/security-review [F05]` run one kind of review on their own.
- The status line and `/progress` show which features are still unreviewed. Launch requires all of them to be reviewed.

## Token hygiene

- Tests: always `npm run test:ai` (one line when green); use `-- --changed` while building, and the feature folder at close.
- Don’t read other features’ docs unless the ticket depends on them; use their `index.ts`.
- Delegate wide searches and reviews to subagents; `/compact` or start fresh between tickets.
