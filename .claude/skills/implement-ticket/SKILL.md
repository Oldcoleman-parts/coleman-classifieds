---
name: implement-ticket
description: Build one ticket (plan → approve → build → test → try). No code review or security audit here; those are on demand. Use as "/implement-ticket F03-T1".
argument-hint: "[ticket id, e.g. F03-T1]"
disable-model-invocation: true
---

# Implement $ARGUMENTS

1. Set **Status: In progress** (in the ticket and the feature README). Read the ticket, the feature README and the module `CLAUDE.md`. If dependency features aren’t Done, stop and say which.
2. **Plan:** delegate to `feature-planner`. Show the plan and **wait for the user’s OK**.
3. **Schema first:** run `/schema-change` if needed.
4. **Build** only the scope, inside the feature’s module(s) plus thin routes. Follow the module’s `security-<module>` skill while coding (it loads automatically). Tick the Scope boxes as you go. Use `/new-module`, `/add-webhook`, `/add-email-template` and `/shopify-graphql` as needed.
5. **Test:** delegate to `test-writer`. It runs `npm run test:ai -- --changed` and returns only a criteria → test table.
6. **Try it:** give 3–5 manual steps (or `/dev-store-qa $ARGUMENTS` for bigger tickets).
7. **Close:** `/close-ticket $ARGUMENTS`.

Don’t run code review or security audits here. Mention “unreviewed changes” at the end, so the user knows a `/review-all` is due when they choose.
