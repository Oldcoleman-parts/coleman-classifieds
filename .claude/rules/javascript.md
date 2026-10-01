---
paths:
  - "app/**/*.js"
  - "app/**/*.jsx"
  - "tests/**"
  - "extensions/**/*.js"
---

# JavaScript conventions

- This project uses **JavaScript, not TypeScript**: ES modules, `.js` for logic and `.jsx` for React components and routes. Never add `.ts`/`.tsx` files, `tsconfig.json` or TypeScript dependencies.
- Document shared shapes with **JSDoc** `@typedef` in one place per module (for example `core/types.js` for `Listing` and `Invitation`, and `core/events.js` for event payloads). Annotate public `index.js` functions with `@param` and `@returns`.
- Without compile-time types, **validate at the boundaries**: route inputs, form data, webhook payloads and API responses go through small validator functions (or a schema library such as zod) before reaching services. Never trust shapes implicitly.
- Prefer named exports, apart from React Router route modules (which need `default` and `loader`/`action` exports).
- Use `const` and `let` (never `var`), `async`/`await`, and optional chaining. No implicit globals.
- Errors: throw custom error classes (`ValidationError`, `NotFoundError`, `ShopifyUserError`) defined in `core/errors.js`, never strings.
- Money in integer cents, dates as `Date` or ISO strings, IDs as strings. The same rules as `docs/architecture/data-model.md`.
