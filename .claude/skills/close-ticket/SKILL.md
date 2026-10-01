---
name: close-ticket
description: Verify and close a ticket and update its status everywhere. Doesn't require reviews (those are on demand).
argument-hint: "[ticket id]"
disable-model-invocation: true
---

# Close $ARGUMENTS

1. Run `npm run test:ai -- app/modules/<module>` for the feature’s module(s). It must be green.
2. Tick each acceptance criterion only if a test or a recorded manual check covers it. If something isn’t covered, list it and stop.
3. Set **Status: Done** in the ticket and the feature README. If all tickets are done, set the feature to Done in `docs/README.md`.
4. Write decisions and follow-ups under _Notes_ (use `docs-keeper` for other features).
5. Give the exact commit command, with the ticket ID in the message: `git add -A && git commit -m "feat(<module>): <title> ($ARGUMENTS)"`. One commit (or a few) per ticket keeps it easy to find or revert on a single branch.
6. Remind the user: this feature is **unreviewed** until the next `/review-all`.
