---
name: start-feature
description: Load one feature's context (spec, module memory, tickets, dependency public APIs) and nothing else. Use as "/start-feature 04".
argument-hint: "[feature number, e.g. 04]"
disable-model-invocation: true
---

# Start feature $ARGUMENTS

1. Read `docs/features/$ARGUMENTS-*/README.md` and the `CLAUDE.md` of each of its module folders.
2. For dependencies, read **only** their `index.js` exports and published events (`docs/architecture/events.md`).
3. List the tickets (and any `FIX` tickets) with their status, and suggest the next one.
4. Don’t write code. Ask which ticket to start.
