# F01-FIX-5 — Shared rate limit and client IP in platform

|                     |                                             |
| ------------------- | ------------------------------------------- |
| **Status**          | Done                                        |
| **Feature**         | [F01 Foundation and platform](../README.md) |
| **Module(s)**       | `platform`, `access` (caller)               |
| **Security skills** | `security-platform`, `security-access`      |

Start with `/implement-ticket F01-FIX-5`. Follow-up from [F04-T1](../../04-seller-journey/tickets/F04-T1.md) (Notes: rate limits are in memory).

## Scope

- [x] A shared `rateLimit()` and `clientIp(request)` in `platform`, exported from `app/modules/platform/index.js`. Use `app/modules/access/services/rate-limit.js` (`hit()`, `clientIp()`, `resetRateLimits()` for tests) as the model: in memory, one Railway instance.
- [x] Access switches to it and its local `rate-limit.js` is removed.
- [x] F07 contact can use the same helper (note it in the F07 ticket notes).

## Out of scope

- A shared store (Redis or the database) for several instances.
- Changing access’s limits.

## Acceptance criteria

- [x] Limits per key and window are enforced and reset after the window; keys don’t share counters.
- [x] `clientIp()` reads the proxy’s forwarded header the same way access does today, and never trusts a value it can’t parse.
- [x] Access’s rate-limit tests pass against the platform helper.
- [x] `npm run test:ai` is green for `platform` and `access`.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Requested by F04-T1 (2026-10-06).
- Memory must stay bounded (expired entries pruned).
- Built (2026-10-19): `app/modules/platform/services/rate-limit.js` exports `rateLimit()`, `clientIp()`, `resetRateLimits()` (all through `index.js`) and `rateLimitSize()` (tests only). Access's `services/rate-limit.js` is removed; `email-codes.js`, `seller-gate.js` and `my-link.js` call `rateLimit()` with the same keys and limits. F07-T1 and F07-T2 notes point to the helper.
- DECISION: `clientIp()` reads at most the first 512 characters of `X-Forwarded-For` and keeps the first entry only when `isIP()` accepts it (lower-cased); anything else, including a port or brackets, is `"unknown"`. The first entry is still trusted, as before (Shopify's proxy sets it).
- DECISION: pruning is unchanged (a full scan of expired keys once more than 10,000 are held). A cheaper structure is a follow-up only if it ever shows up under load.
- Follow-up (F06-T1, already noted there): payments drops its copy `payments/services/rate-limit.js` (`resetPayLimits`) for this helper.
- Tests (2026-10-19): `platform/tests/rate-limit.test.js` (15) covers the criteria; platform, core, scheduler, access and workspace green (458). Manual QA (recommended, not yet recorded): on the dev store, submit Get my link 11 times within an hour from one network (different emails); the 11th answers "too many requests". Then submit once from another network (a phone on mobile data): it must still work. That proves the proxy's forwarded IP parses; if it were `"unknown"` for everyone, the phone would be refused too.
