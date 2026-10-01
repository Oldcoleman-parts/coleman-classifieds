# Architecture rules (always loaded)

- This is a **modular monolith**: one Shopify app, one deployment, one database. Modules live in `app/modules/<name>/` (see `docs/architecture/architecture.md`).
- **Every listing status change goes through `core/lifecycle.transition()`.** Never write `listing.status` directly.
- Modules communicate only through **internal events** (`core/events`) or another module's public `index.js`. Never import another module's `services/` or query its tables.
- Only `core` and `platform` may be imported by every module.
- Route files (`app/routes/*`) stay thin: validate input, call a module function, return a response.
- Optional features are behind `core/flags.isEnabled()`: alerts (on at launch), renewals (Phase 2) and open submissions (later). When a flag is off, the module registers no listeners and its routes return 404. Unreleased features stay hidden through their `*_RELEASED` env gate.
- Work on one ticket at a time. Build only what's in its _Scope_.
- When the spec is unclear, use the documented default, add `// DECISION:` in code, and record it under the ticket's _Notes_.
