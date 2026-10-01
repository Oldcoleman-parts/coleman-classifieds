# Feature scope rules (always loaded)

- Each session works on **one feature and one ticket**. Load context with `/start-feature <NN>`.
- Only edit files in the current feature's module(s), plus thin route files and tests. If a change is needed in another module, stop and propose it as a follow-up ticket in that feature's `tickets/` folder.
- Cross-feature needs are met through `index.ts` functions and events in `docs/architecture/events.md`. If an event is missing, add it to that doc in the same change.
- When a ticket changes behaviour described in a feature README, update the README in the same change.
- Never mark acceptance criteria done without a test or a recorded manual QA step.

- Code review and security audits are **not** part of the ticket loop. They run on demand (`/review-all`). Still follow the security skill for the module you’re editing while writing code.
- Fix tickets created by reviews (`FNN-FIX-N`) are handled like normal tickets.
