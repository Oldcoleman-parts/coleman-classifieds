# Coleman Classifieds (2026-10-01 structure)

Custom Shopify app for Old Coleman Parts, organised for building with **Claude Code**, feature by feature.

**Starting point:** the app is created with `shopify app init` (React Router template, JavaScript) and is running on the dev store. F01 adapts and extends the template; nothing is re-scaffolded.

- **9 features, 17 tickets:** 7 launch features (14 tickets), renewals in Phase 2, open submissions later. See `docs/README.md`.
- **Fast build loop:** `/start-feature` → `/implement-ticket` → `/close-ticket`.
- **Reviews on demand:** `/review-all` whenever you choose. A final review is required before launch.
- **Token-light tests:** `npm run test:ai`.

## Add this structure to your existing app

```bash
cd <your-shopify-app>                      # created with shopify app init
cp -rn <this-folder>/{.claude,docs,scripts,AGENTS.md,.mcp.json} .
# CLAUDE.md: copy it, or if you already have one, add "@AGENTS.md" as its first line
# .gitignore: merge by hand
git add -A && git commit -m "chore: add Claude Code structure"
claude
```

Then, in Claude: `/baseline-sync 01` (optional read-only check) → `/start-feature 01` → `/implement-ticket F01-T1`.
