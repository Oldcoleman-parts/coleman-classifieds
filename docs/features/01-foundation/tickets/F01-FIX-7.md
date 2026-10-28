# F01-FIX-7 — The production server must not log seller links

|                     |                                             |
| ------------------- | ------------------------------------------- |
| **Status**          | Done                                        |
| **Feature**         | [F01 Foundation and platform](../README.md) |
| **Module(s)**       | `platform` (server start-up)                |
| **Security skills** | `security-platform`, `security-access`      |

Start with `/implement-ticket F01-FIX-7`. From [review 3](../../../reviews/2026-10-07-review-3.md) (**High**, security audit of `access`). Must be done before launch.

## Problem

`package.json` starts production with `react-router-serve`, which always installs `morgan("tiny")` (`node_modules/@react-router/serve/dist/cli.js:130`). Every request line is written to the hosting logs, including `/proxy/seller/<token>…`. Anyone with log access can open a seller's listing: directly when the email code is off, and as the first factor when it is on. This breaks non-negotiable 5 (tokens are never logged). The log-spy tests in `access` cannot see it, because the logger sits outside the app code.

## Scope

- [x] Production no longer writes seller tokens to the logs. Either start from a small custom server (Express with `@react-router/express`) that has no URL logger, or keep a request log that replaces the token segment of `/proxy/seller/<token>` (and the storefront form `/apps/classifieds/…` if it reaches the server) with a fixed marker.
- [x] Query strings are not logged either (the app proxy signature, and `?email=` on the invitation screen until that is moved to POST).
- [x] The `start` script in `package.json` is extended, not replaced wholesale; `docker-start` and `setup` keep working (`.claude/rules/03-existing-template-app.md`).
- [x] `shopify app dev` is unchanged.

## Out of scope

- Moving the earlier-listings lookup to POST (a review 3 Low in `access`).
- Rate limits and client IP (F01-FIX-5).

## Acceptance criteria

- [x] A request to a seller page in a production-mode start leaves no token in stdout or stderr (test on the redaction or on the server's logging, with a token-shaped path).
- [x] No query string appears in the request log.
- [x] The app still builds, starts with `npm run start`, installs and opens on the dev store (recorded manual check).
- [x] `npm run test:ai` is green for `platform`.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- **Manual check (2026-10-07):** `npm run build` passes. A local `npm run start` with placeholder settings and no database listened on its port; four token-shaped requests (GET, POST, a GET on a POST-only route, a malformed path) left no token and no `?` in the output, e.g. `GET /proxy/seller/[redacted]/draft 400 12ms`. The user then checked with `shopify app dev`: the app installs and opens on the dev store and a seller link loads. The same check under `npm run start` on a hosted app waits for the staging app (F08-T3).
- Existing production logs may already contain seller links. A human should decide whether to clear them or re-issue open links once this is deployed.
- **Decision: our own Express server, with a redacted request log.** `react-router-serve` has no switch for its URL logger, so `npm run start` now runs `app/modules/platform/server/start.js`. It keeps the same static files, compression, `PORT`/`HOST` and shutdown. The log line is method, path, status and duration, written by hand so the raw URL never reaches a formatter.
- **Decision: redaction by allow-list.** Under `/proxy/` and `/apps/classifieds/` only the words in `PROXY_WORDS` (`server/request-log.js`) are kept; every other segment becomes `[redacted]`. A new route or token format therefore fails safe. Elsewhere a segment over 32 characters is redacted (`// DECISION` in the file); database ids stay readable.
- **Found while planning: a second leak.** The seller routes that only accept POST answer a GET (a refresh) with an error that quotes the full path, and React Router's default `handleError` prints it. `app/entry.server.jsx` now exports `handleError = logRequestError` (`platform/services/server-errors.js`), which logs the status and the redacted path. One added export; the rest of the template file is unchanged.
- Express's own error output is replaced too: a malformed path logs `URIError GET /proxy/seller/[redacted]`.
- `express`, `compression`, `@react-router/express` and `source-map-support` are now direct dependencies at the versions already installed. `@react-router/serve` is no longer a dependency of the app, but npm still installs it as a peer of `@react-router/dev`; no script starts it.
- The Shopify library prints every request parameter at debug level. `docs/architecture/operations.md` now says never to use that level in production.
- Follow-up (F04, `access`): give the POST-only seller routes a loader that redirects to the seller page, so a refresh does not show an error.
- Follow-up (F08-T3): `railway.json` health-checks `/`, and there is no index route, so the check may fail (not run).
- Follow-up (F08-T3): check whether Railway's own HTTP logs record request paths. No app change can hide them there.
- Follow-up (F08-T3): repeat the "installs and opens" check on the staging app once it exists.
