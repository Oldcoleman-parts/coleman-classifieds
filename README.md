# Coleman Classifieds (2026-10-01 structure)

Custom Shopify app for Old Coleman Parts. This repo is organised for building with **Claude Code**, feature by feature.

- **9 features, 17 tickets:** 7 launch features (14 tickets), renewals in Phase 2, open submissions later. See `docs/README.md`.
- **Fast build loop:** `/start-feature` → `/implement-ticket` → `/close-ticket`.
- **Reviews on demand:** `/review-all` whenever you choose, with saved reports, fix tickets and checkpoints. A final review is required before launch.
- **Token-light tests:** `npm run test:ai` gives a one-line summary when green, and failures only when red.

## Getting started

1. `shopify app init` (React Router template) in this folder’s parent. Then copy this folder’s contents into the new app (see `docs/CHEATSHEET.md`).
2. Add the package scripts that F01-T1 requires: `"test:ai": "node scripts/test-summary.mjs"`, `"lint"`, `"typecheck"`.
3. Run `git init`, commit, then `claude` → `/next`.
