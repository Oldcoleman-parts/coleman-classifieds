---
name: baseline-sync
description: Read-only check of the existing app against the docs and tickets. Reports what already exists, what's missing or different, and proposes ticket and doc updates. Use before starting a feature on code that already exists, or after code was written outside the ticket workflow. Use as "/baseline-sync" or "/baseline-sync 01".
argument-hint: "[optional feature number]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(git log:*), Bash(git status:*), Bash(node scripts/progress.mjs:*)
---

# Baseline sync $ARGUMENTS

Don’t change any code.

1. Read `AGENTS.md`, `docs/architecture/*` and the feature(s) in scope (all features if none is given).
2. Inspect the real app: `package.json`, `shopify.app.toml`, `prisma/schema.prisma`, `app/shopify.server.js`, `app/routes/`, `app/modules/`, tests and CI.
3. For each ticket in scope, report:
   - **Already satisfied:** each scope item and criterion, with file paths as evidence;
   - **Missing:** what still needs building;
   - **Different from the docs:** the code differs from the plan, with a recommendation either way.
4. Propose the edits: tick the satisfied boxes; doc corrections (architecture, data model, Shopify config); new `FNN-FIX-N` tickets for gaps outside the normal tickets.
5. Ask the user to confirm, then apply the **doc and ticket** edits only, through the `docs-keeper` agent.
