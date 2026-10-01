---
name: new-module
description: Scaffold a new feature module folder under app/modules following the project's module conventions (index.js, events.js, services, routes, tests).
argument-hint: "[module name]"
---

# Scaffold module `$ARGUMENTS`

Create:

```
app/modules/$ARGUMENTS/
  index.js        # public API only — the only file other modules may import
  events.js       # subscribe(...) registrations; guarded by flags if Phase 2
  services/       # internal logic (*.server.js)
  routes/         # loaders/actions used by thin files in app/routes
  tests/
```

- `index.js` exports a `register()` function that `events.js` calls from the app bootstrap. For Phase 2 modules, `register()` checks `flags.isEnabled()`.
- If the module adds scheduled work, export a `runScheduled()` function and add it to the scheduler registry.
- Add the module to the modules table in `docs/architecture/architecture.md` if it's new, and create `app/modules/$ARGUMENTS/CLAUDE.md` (purpose, owned data, events, security skill, boundaries).
