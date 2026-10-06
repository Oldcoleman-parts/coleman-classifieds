# F01-FIX-5 — Shared rate limit and client IP in platform

|                     |                                             |
| ------------------- | ------------------------------------------- |
| **Status**          | To do                                       |
| **Feature**         | [F01 Foundation and platform](../README.md) |
| **Module(s)**       | `platform`, `access` (caller)               |
| **Security skills** | `security-platform`, `security-access`      |

Start with `/implement-ticket F01-FIX-5`. Follow-up from [F04-T1](../../04-seller-journey/tickets/F04-T1.md) (Notes: rate limits are in memory).

## Scope

- [ ] A shared `rateLimit()` and `clientIp(request)` in `platform`, exported from `app/modules/platform/index.js`. Use `app/modules/access/services/rate-limit.js` (`hit()`, `clientIp()`, `resetRateLimits()` for tests) as the model: in memory, one Railway instance.
- [ ] Access switches to it and its local `rate-limit.js` is removed.
- [ ] F07 contact can use the same helper (note it in the F07 ticket notes).

## Out of scope

- A shared store (Redis or the database) for several instances.
- Changing access’s limits.

## Acceptance criteria

- [ ] Limits per key and window are enforced and reset after the window; keys don’t share counters.
- [ ] `clientIp()` reads the proxy’s forwarded header the same way access does today, and never trusts a value it can’t parse.
- [ ] Access’s rate-limit tests pass against the platform helper.
- [ ] `npm run test:ai` is green for `platform` and `access`.

## Notes

_Record decisions (`// DECISION:`), deviations and follow-ups here._

- Requested by F04-T1 (2026-10-06).
- Memory must stay bounded (expired entries pruned).
