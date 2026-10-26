# Module `platform` — part of F01 Foundation and platform

Project setup, hosting, the Shopify platform layer, the full database schema and the core listing lifecycle that every other feature uses.

- **Spec and tickets:** `docs/features/01-foundation/`
- **Security skill:** `security-platform` (loads automatically when you edit this module; audits are on demand).
- **Events:** Defines the event bus and every event in `docs/architecture/events.md`; publishes lifecycle events from `transition()`.

## Rules for this feature

- State changes only through `transition()`. Invalid transitions throw.
- The audit log is append-only (DB trigger); only the retention purge role can delete.
- Flags are read through `flags.isEnabled()`; release gates come from env (`RENEWALS_RELEASED`, `OPEN_SUBMISSIONS_RELEASED`).
- Month maths uses `addMonths` in the shop timezone. Time adjustments only go through `adjustTime()`.

## How it is built

- **Production server (F01-FIX-7):** `npm run start` runs `server/start.js`, our own Express server, instead of `react-router-serve` (which logs every full URL). `server/app.js` builds the app and `server/request-log.js` writes one line per request, e.g. `GET /proxy/seller/[redacted]/draft 200 12ms`. `shopify app dev` does not use these files.
- Files in `server/` are plain Node, run outside the Vite build: relative imports only, no `@/`, no app code.
- The request log never holds a query string, a header or a seller token. Under `/proxy/` and `/apps/classifieds/` only the words in `PROXY_WORDS` are kept. **When you add a proxy route, add its segment there**, or it is logged as `[redacted]`.
- **Webhook receipts (F01-FIX-2):** `handleWebhook()` claims a delivery with a `WebhookReceipt` and sets `processedAt` only after the handler succeeded. An unprocessed receipt older than 60 s is taken over and the handler runs again; a newer one answers 500. **A handler may run twice: it must be idempotent**, and should finish well under Shopify's 5 s timeout (never near 60 s).
- **Webhook failure logs (F01-FIX-8):** every answer but 200 writes exactly one `[webhooks] TOPIC ID step: Class code` line. Steps: `method`, `signature`, `authenticate`, `claim`, `busy`, `handler`, `handler, claim kept`, `receipt`. Before verification the topic is the normalised header and the ID is `-`. Never the message, payload, headers or tokens. An unexpected error from `authenticate.webhook` or `claim()` answers 500 so Shopify retries; a bad signature stays 401.
- **Rate limit (F01-FIX-5):** `rateLimit(key, { limit, windowMs })` and `clientIp(request)` in `services/rate-limit.js`, for every public endpoint. A fixed window in memory (one instance; resets on deploy), expired keys pruned past 10,000. `clientIp()` is the first `X-Forwarded-For` entry only when it is a plain IPv4/IPv6 address, otherwise `"unknown"`. Hash personal keys (an email) before using them as a key. Tests call `resetRateLimits()`.
- `logRequestError` (`services/server-errors.js`) is the `handleError` of `app/entry.server.jsx`. React Router's default one prints the request path.

## Boundaries

- Export only through `index.js`. Never import other modules’ `services/`; use their `index.js` or events.
- Status changes go through `core` `transition()`.
