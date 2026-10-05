---
name: progress
description: Show done, left and unreviewed work, overall or for one feature or module, e.g. "/progress", "/progress 06" or "/progress payments".
argument-hint: "[optional feature number or module]"
allowed-tools: Read, Glob, Grep, Bash(node scripts/progress.mjs:*)
---

# Progress $ARGUMENTS

- No argument: `node scripts/progress.mjs --summary` (features, tickets, review status).
- A feature or module (map it using AGENTS.md): `node scripts/progress.mjs --feature NN`, then list the unticked Scope items and acceptance criteria per ticket, and any open FIX tickets.
- End with the single next command.
