# Existing template app (always loaded)

- This app was created with **`shopify app init` (React Router template)**, runs with `shopify app dev`, and is installed on the dev store. **Never** re-run `shopify app init`, re-scaffold, or replace template files wholesale.
- Before planning any ticket, check what already exists (template files, earlier features) and plan **only** the gaps. Tick scope items that are already satisfied, and cite the file paths.
- Template files to **extend, not rewrite**: `app/shopify.server.ts`, `app/db.server.ts`, `app/root.tsx`, `app/entry.server.tsx`, `app/routes/app.tsx`, `app/routes/auth.*`, `app/routes/webhooks.app.*`, `shopify.app.toml`, `shopify.web.toml`, `vite.config.ts`, the `package.json` scripts.
- Keep the template `Session` model and auth flow working. After any change to auth, config or the database, confirm the app still installs and opens on the dev store.
- Use the template’s auth helpers (`authenticate.admin`, `authenticate.webhook`, `authenticate.public.appProxy`). Don’t build parallel auth.
- Changes to `shopify.app.toml` (scopes, webhooks, proxy) take effect through `shopify app dev` (dev store) or `shopify app deploy` (a human runs it). Tell the user when a re-auth or deploy is needed.
