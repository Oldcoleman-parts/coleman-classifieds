# Architecture

## Approach

A **modular monolith**: one Shopify app, one deployment, one PostgreSQL database. Each feature owns a module in `app/modules/`, with its own `CLAUDE.md`, `index.js` (public API), `events.js`, `services/`, `routes/` and `tests/`. Modules communicate through the event bus (`docs/architecture/events.md`) or public `index.js` functions only.

## Stack

| Concern                    | Choice                                                                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App framework              | Shopify official app template (**React Router**, formerly Remix), Node.js, **JavaScript** (ES modules, `.js`/`.jsx`, JSDoc for key shapes)                                                                        |
| Admin UI                   | Embedded app, **App Bridge + Polaris**                                                                                                                                                                            |
| Storefront UI              | **Theme app extension** (app blocks) + one small theme snippet for the menu button                                                                                                                                |
| Seller page / contact form | **App proxy** (served on OCP domain)                                                                                                                                                                              |
| Database                   | PostgreSQL via **Prisma**                                                                                                                                                                                         |
| Hosting                    | **Railway** — separate project, own Postgres, own GitHub repo; cron service for jobs. Production starts the app from `platform/server/start.js` (Express), whose request log holds no seller link or query string |
| Photo storage              | **Amazon S3** (private bucket) for **all** seller photos — drafts, review and live. Photos are never stored in Shopify Files                                                                                      |
| Photo delivery             | **Amazon CloudFront** in front of a `public/` prefix of the bucket (Origin Access Control); pre-generated sizes                                                                                                   |
| Email                      | **Amazon SES** sent directly by the app (Shopify notifications/Shopify Email cannot be used — see F03). Two configuration sets: `transactional` and `alerts`; bounces/complaints via SNS → app webhook            |
| Spam protection            | **Cloudflare Turnstile** + rate limits + honeypot                                                                                                                                                                 |
| Image processing           | `sharp` (resize, re-encode JPEG, strip EXIF/GPS, HEIC→JPEG)                                                                                                                                                       |
| Distribution               | Custom app, custom distribution, installed on OCP's store only                                                                                                                                                    |

Use the latest stable Admin API version supported by the template at build time and pin it in `shopify.app.toml`.

---

| Hosting | **Railway** (OCP-owned project): app service, Postgres, cron service |
| Code | GitHub repo owned by OCP |

## Modules

| Module              | Feature                    | Owns data                                                           | Public API (index.js) highlights                                                                       |
| ------------------- | -------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `platform`          | F01                        | `Session`, `WebhookReceipt`                                         | `adminGraphql()`, `storefrontGraphql()`, `withAppProxy()`, webhook router, `redactRequestPath()`       |
| `core`              | F01 (+F02 settings writer) | `Listing`, `Settings`, `AuditEvent`, `ListingTimeAdjustment`        | `transition()`, `events`, `flags`, `settings`, `audit`, `getListingSummary()`                          |
| `access`            | F04 (+F10 `access/public`) | `Invitation`, `EmailCode`                                           | `createInvitation()`, `resolveToken()`, `revoke()`                                                     |
| `notifications`     | F03                        | `EmailTemplate`, `EmailSettings`, `EmailSuppression`, `EmailOutbox` | `send()`, `notifyStaff()`, `handleSesWebhook()`                                                        |
| `media`             | F03                        | `Photo`                                                             | `createUploadUrl()`, `completeUpload()`, `listPhotos()`, `publish()`, `getPublicUrls()`, `unpublish()` |
| `workspace`         | F04                        | `ListingRevision`, `TermsAcceptance`                                | seller page loaders and actions                                                                        |
| `console`           | F02, F05                   | —                                                                   | admin shell, settings, admin screens, history export                                                   |
| `payments`          | F06                        | `FeeCharge`, `ListingPeriod`                                        | `createCheckout()`, fee product bootstrap                                                              |
| `publishing`        | F06                        | metaobject, `classifieds.live_count` metafield                      | `syncListing()`, `recomputeLiveCount()`, `getStorefrontCount()`, `retireListing()`                     |
| `contact`           | F07                        | `BuyerMessage`                                                      | `submitMessage()`, `listHeld()`, `release()`, `discard()`                                              |
| `alerts`            | F07                        | `AlertSubscriber`, `AlertQueue`                                     | `subscribe()`, `sendPendingAlerts()`                                                                          |
| `scheduler` + `ops` | F01 (runner), F08          | `OpsIncident`                                                       | `runScheduled()`, `raiseIncident()`                                                                    |
| `payments/renewals` | F09                        | uses `FeeCharge`, `ListingPeriod`                                   | billing attempts                                                                                       |

## Starting point: the Shopify template

The app was created with `shopify app init` (React Router template) and runs on the dev store. Template files are **extended, never replaced** (see `.claude/rules/03-existing-template-app.md`):

- `app/shopify.server.js`: auth, session storage, the `authenticate.*` helpers (used by `platform`);
- `app/db.server.js`: the Prisma client (used through `core`);
- `app/routes/app.jsx`, `app/routes/app._index.jsx`, `app/routes/auth.*`, `app/routes/webhooks.app.*`: shell, auth and the default webhooks;
- `prisma/schema.prisma`: the template `Session` model is kept, and the project models are added (PostgreSQL);
- `shopify.app.toml`, `shopify.web.toml`, `vite.config.js`, the `package.json` scripts.

New project code lives in `app/modules/<module>/`. Template routes stay where they are; new routes are thin files in `app/routes/` that call module functions.

## Repository layout

```
AGENTS.md  CLAUDE.md  .mcp.json  .claude/ (settings, rules, skills, agents)
docs/ (product, architecture, features/<NN>/README.md + tickets, reviews, reference)
scripts/ (progress.mjs, test-summary.mjs, format-hook.mjs)
prisma/schema.prisma
app/routes/            thin route files: app.* (admin), proxy.* (seller/public), webhooks.*, jobs.run
app/modules/<module>/  CLAUDE.md · index.js · events.js · services/ · routes/ · tests/
emails/                shared layout + seed defaults
extensions/classifieds-theme/   theme app extension (browse, listing, alerts signup blocks)
theme-snippets/classifieds-header-button.liquid
```

## Account ownership

All service accounts are **owned by OCP**, with developer access: AWS (S3, CloudFront, SES), Railway, GitHub, the DNS/email domain, and the Shopify app (custom distribution to OCP's store).
