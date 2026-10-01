---
name: new-module
description: Scaffold a new feature module folder under app/modules following the project's module conventions (index.ts, events.ts, services, routes, tests).
argument-hint: "[module name]"
---

# Scaffold module `$ARGUMENTS`

Create:

```
app/modules/$ARGUMENTS/
  index.ts        # public API only — the only file other modules may import
  events.ts       # subscribe(...) registrations; guarded by flags if Phase 2
  services/       # internal logic (*.server.ts)
  routes/         # loaders/actions used by thin files in app/routes
  tests/
```

- `index.ts` exports a `register()` function that `events.ts` calls from the app bootstrap. For Phase 2 modules, `register()` checks `flags.isEnabled()`.
- If the module adds scheduled work, export a `runScheduled()` function and add it to the scheduler registry.
- Add the module to the modules table in `docs/architecture/architecture.md` if it's new, and create `app/modules/$ARGUMENTS/CLAUDE.md` (purpose, owned data, events, security skill, boundaries).
