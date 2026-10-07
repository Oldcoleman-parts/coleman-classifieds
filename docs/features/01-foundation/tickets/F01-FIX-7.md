# F01-FIX-7 — The production server must not log seller links

|                     |                                             |
| ------------------- | ------------------------------------------- |
| **Status**          | To do                                       |
| **Feature**         | [F01 Foundation and platform](../README.md) |
| **Module(s)**       | `platform` (server start-up)                |
| **Security skills** | `security-platform`, `security-access`      |

Start with `/implement-ticket F01-FIX-7`. From [review 3](../../../reviews/2026-10-07-review-3.md) (**High**, security audit of `access`). Must be done before launch.

## Problem

`package.json` starts production with `react-router-serve`, which always installs `morgan("tiny")` (`node_modules/@react-router/serve/dist/cli.js:130`). Every request line is written to the hosting logs, including `/proxy/seller/<token>…`. Anyone with log access can open a seller's listing: directly when the email code is off, and as the first factor when it is on. This breaks non-negotiable 5 (tokens are never logged). The log-spy tests in `access` cannot see it, because the logger sits outside the app code.

## Scope

- [ ] Production no longer writes seller tokens to the logs. Either start from a small custom server (Express with `@react-router/express`) that has no URL logger, or keep a request log that replaces the token segment of `/proxy/seller/<token>` (and the storefront form `/apps/classifieds/…` if it reaches the server) with a fixed marker.
- [ ] Query strings are not logged either (the app proxy signature, and `?email=` on the invitation screen until that is moved to POST).
- [ ] The `start` script in `package.json` is extended, not replaced wholesale; `docker-start` and `setup` keep working (`.claude/rules/03-existing-template-app.md`).
- [ ] `shopify app dev` is unchanged.

## Out of scope

- Moving the earlier-listings lookup to POST (a review 3 Low in `access`).
- Rate limits and client IP (F01-FIX-5).

## Acceptance criteria

- [ ] A request to a seller page in a production-mode start leaves no token in stdout or stderr (test on the redaction or on the server's logging, with a token-shaped path).
- [ ] No query string appears in the request log.
- [ ] The app still builds, starts with `npm run start`, installs and opens on the dev store (recorded manual check).
- [ ] `npm run test:ai` is green for `platform`.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Existing production logs may already contain seller links. A human should decide whether to clear them or re-issue open links once this is deployed.
