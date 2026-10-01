# Architecture

## Approach

A **modular monolith**: one Shopify app, one deployment, one PostgreSQL database. Each feature owns a module in `app/modules/`, with its own `CLAUDE.md`, `index.ts` (public API), `events.ts`, `services/`, `routes/` and `tests/`. Modules communicate through the event bus (`docs/architecture/events.md`) or public `index.ts` functions only.

## Stack

| Concern                    | Choice                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App framework              | Shopify official app template (**React Router**, formerly Remix), Node.js, TypeScript                                                                                                                  |
| Admin UI                   | Embedded app, **App Bridge + Polaris**                                                                                                                                                                 |
| Storefront UI              | **Theme app extension** (app blocks) + one small theme snippet for the menu button                                                                                                                     |
| Seller page / contact form | **App proxy** (served on OCP domain)                                                                                                                                                                   |
| Database                   | PostgreSQL via **Prisma**                                                                                                                                                                              |
| Hosting                    | **Railway** — separate project, own Postgres, own GitHub repo; cron service for jobs                                                                                                                   |
| Photo storage              | **Amazon S3** (private bucket) for **all** seller photos — drafts, review and live. Photos are never stored in Shopify Files                                                                           |
| Photo delivery             | **Amazon CloudFront** in front of a `public/` prefix of the bucket (Origin Access Control); pre-generated sizes                                                                                        |
| Email                      | **Amazon SES** sent directly by the app (Shopify notifications/Shopify Email cannot be used — see F03). Two configuration sets: `transactional` and `alerts`; bounces/complaints via SNS → app webhook |
| Spam protection            | **Cloudflare Turnstile** + rate limits + honeypot                                                                                                                                                      |
| Image processing           | `sharp` (resize, re-encode JPEG, strip EXIF/GPS, HEIC→JPEG)                                                                                                                                            |
| Distribution               | Custom app, custom distribution, installed on OCP's store only                                                                                                                                         |

Use the latest stable Admin API version supported by the template at build time and pin it in `shopify.app.toml`.

---

| Hosting | **Railway** (OCP-owned project): app service, Postgres, cron service |
| Code | GitHub repo owned by OCP |

## Modules

| Module              | Feature                    | Owns data                                                    | Public API (index.ts) highlights                                         |
| ------------------- | -------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `platform`          | F01                        | `Session`, `WebhookReceipt`                                  | `adminGraphql()`, `storefrontGraphql()`, `verifyProxy()`, webhook router |
| `core`              | F01                        | `Listing`, `Settings`, `AuditEvent`, `ListingTimeAdjustment` | `transition()`, `events`, `flags`, `settings`, `audit`                   |
| `access`            | F03 (+F09 `access/public`) | `Invitation`, `EmailCode`                                    | `createInvitation()`, `resolveToken()`, `revoke()`                       |
| `notifications`     | F02                        | `EmailTemplate`, `EmailSettings`, `EmailSuppression`         | `send()`, `notifyStaff()`                                                |
| `media`             | F02                        | `Photo`                                                      | `createUploadUrl()`, `completeUpload()`, `publish()`, `unpublish()`      |
| `workspace`         | F03                        | `ListingRevision`, `TermsAcceptance`                         | seller page loaders and actions                                          |
| `console`           | F04                        | —                                                            | admin screens, history export                                            |
| `payments`          | F05                        | `FeeCharge`, `ListingPeriod`                                 | `createCheckout()`, fee product bootstrap                                |
| `publishing`        | F05                        | metaobject, `classifieds.live_count` metafield               | `goLive()`, `syncListing()`, `recomputeLiveCount()`                      |
| `contact`           | F06                        | `BuyerMessage`                                               | `submitMessage()`, `release()`, `discard()`                              |
| `alerts`            | F06                        | `AlertSubscriber`, `AlertQueue`                              | `subscribe()`, `sendDigest()`                                            |
| `scheduler` + `ops` | F01 (runner), F07          | `OpsIncident`                                                | `runScheduled()`, `raiseIncident()`                                      |
| `payments/renewals` | F08                        | uses `FeeCharge`, `ListingPeriod`                            | billing attempts                                                         |

## Starting point: the Shopify template

The app was created with `shopify app init` (React Router template) and runs on the dev store. Template files are **extended, never replaced** (see `.claude/rules/03-existing-template-app.md`):

- `app/shopify.server.ts`: auth, session storage, the `authenticate.*` helpers (used by `platform`);
- `app/db.server.ts`: the Prisma client (used through `core`);
- `app/routes/app.tsx`, `app/routes/app._index.tsx`, `app/routes/auth.*`, `app/routes/webhooks.app.*`: shell, auth and the default webhooks;
- `prisma/schema.prisma`: the template `Session` model is kept, and the project models are added (PostgreSQL);
- `shopify.app.toml`, `shopify.web.toml`, `vite.config.ts`, the `package.json` scripts.

New project code lives in `app/modules/<module>/`. Template routes stay where they are; new routes are thin files in `app/routes/` that call module functions.

## Repository layout

```
AGENTS.md  CLAUDE.md  .mcp.json  .claude/ (settings, rules, skills, agents)
docs/ (product, architecture, features/<NN>/README.md + tickets, reviews, reference)
scripts/ (progress.mjs, test-summary.mjs, format-hook.mjs)
prisma/schema.prisma
app/routes/            thin route files: app.* (admin), proxy.* (seller/public), webhooks.*, jobs.run
app/modules/<module>/  CLAUDE.md · index.ts · events.ts · services/ · routes/ · tests/
emails/                shared layout + seed defaults
extensions/classifieds-theme/   theme app extension (browse, listing, alerts signup blocks)
theme-snippets/classifieds-header-button.liquid
```

## Account ownership

All service accounts are **owned by OCP**, with developer access: AWS (S3, CloudFront, SES), Railway, GitHub, the DNS/email domain, and the Shopify app (custom distribution to OCP's store).
