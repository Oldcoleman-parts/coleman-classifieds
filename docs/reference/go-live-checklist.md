# Go-live checklist

Everything that has to happen before (and just after) Coleman Classifieds goes live on oldcolemanparts.com, in order. Each step links to the guide that has the details. Steps marked **(human)** are done by a person: deploys, production migrations, `git push` and account set-up are never done by the agent.

Tick the boxes in a copy of this list (or in F08-T2's Notes) as you go.

## 1. Finish the code (agent, with `/implement-ticket`)

- [x] Review 7 fix tickets: [F03-FIX-5](../features/03-email-and-photos/tickets/F03-FIX-5.md), [F08-FIX-5](../features/08-operations-and-launch/tickets/F08-FIX-5.md) (batches skip rows already sent), [F01-FIX-10](../features/01-foundation/tickets/F01-FIX-10.md), [F08-FIX-6](../features/08-operations-and-launch/tickets/F08-FIX-6.md) (ops reads the audit log through core).
- [x] [F08-T4](../features/08-operations-and-launch/tickets/F08-T4.md) records purge, and [F08-T5](../features/08-operations-and-launch/tickets/F08-T5.md) privacy redact erasure (launch-blocking: Shopify's `customers/redact` and `shop/redact` must really erase).
- [x] [F05-T3](../features/05-staff-console/tickets/F05-T3.md) History list with filters and export.
- [x] Review 8 fix tickets: [F08-FIX-7](../features/08-operations-and-launch/tickets/F08-FIX-7.md) (purge always audited, failures held), [F08-FIX-8](../features/08-operations-and-launch/tickets/F08-FIX-8.md) (erase closes seller listings, suppression kept, shop redact as a job), [F01-FIX-11](../features/01-foundation/tickets/F01-FIX-11.md) (core audit query helpers), [F05-FIX-1](../features/05-staff-console/tickets/F05-FIX-1.md) (History through core), [F05-FIX-2](../features/05-staff-console/tickets/F05-FIX-2.md) (no change needed).
- [ ] Review 9 ([report](../reviews/2026-10-27-review-9.md)): 0 Critical, 0 High. Record the checkpoint in `review-log.json`. Before launch, decide on the 3 Mediums (fix tickets or accept):
  - shop redact checks its budget only between pages of 200, so it can run past the time box;
  - one listing that always fails to close blocks the whole shop/customer erase;
  - no test for the access erase steps (item summary redacted, OPEN invitation closed).
- [ ] [F08-T3](../features/08-operations-and-launch/tickets/F08-T3.md) hosting (section 3 below), then [F08-T2](../features/08-operations-and-launch/tickets/F08-T2.md) backups, `ops.raiseIncident()`, the watchdog and the recovery runbook. F08-T2 must also turn a `PurgeHeld` audit entry into one incident (keyed `purge:<listingId>`); until then a held purge is only a log warning.
- [ ] `/review-all` on everything since the last checkpoint (F08-T3, F08-T2 and any review 9 fixes). Every launch feature must be in `docs/reviews/review-log.json` with no open Critical or High findings.
- [ ] `npm run test:ai` green (last full run: 1279 passed, 1 skipped, at review 9), and CI green on GitHub.

## 2. Accounts and services (human)

- [ ] **Amazon SES** ([ses-setup.md](ses-setup.md)): verify the sending domain (DKIM, custom MAIL FROM, DMARC), create the two configuration sets and the SNS topic, and **request production access early** (about a day; the sandbox only sends to verified addresses). Create the app's credentials.
- [ ] **S3 and CloudFront** ([s3-cloudfront-setup.md](s3-cloudfront-setup.md)): the bucket with versioning and lifecycle rules, CORS, the distribution reading `public/` only, and the app's IAM user.
- [ ] **Backups bucket**: an SSE-KMS prefix (`BACKUP_S3_PREFIX`) for the nightly `pg_dump`, with 30 daily and 12 monthly copies (F08-T2, [operations.md](../architecture/operations.md)).
- [ ] **Cloudflare Turnstile**: a site for oldcolemanparts.com; note the site and secret keys.
- [ ] **Shopify Payments** is on for OCP's store (checkout for the listing fee).
- [ ] **ShippingEasy** ([shippingeasy.md](shippingeasy.md)): the rule that doesn't import orders with SKU `CLASSIFIEDS-FEE`.
- [ ] A password manager entry for `TOKEN_PEPPER` and `JOBS_SECRET`. Losing or changing `TOKEN_PEPPER` breaks every seller link and device sign-in, and makes erased bounced/complained addresses stop counting as suppressed. If it is missing, **every email fails to send** (the suppression check needs it).

## 3. Railway production (human, [railway-setup.md](railway-setup.md))

- [ ] OCP-owned Railway project with **PostgreSQL (daily backups on)** and the **app service** from GitHub. The database user must be allowed to create roles (the first migration creates `classifieds_purge`).
- [ ] Decide the database roles (review 9): the app's login owns `AuditEvent` and its append-only trigger, so it could disable the trigger. Either a separate owner role runs migrations and the app gets INSERT/SELECT plus `classifieds_purge`, or record this as accepted in F08-T3's Notes.
- [ ] **Every environment variable** from [shopify-config.md](../architecture/shopify-config.md) set on the app service, with production values:
  - `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES` (the production app's)
  - `DATABASE_URL`, `SHOP_DOMAIN` (OCP's `*.myshopify.com`), `SHOP_TIMEZONE` (confirm with OCP)
  - `TOKEN_PEPPER`, `JOBS_SECRET`: new long random values, **different from staging**
  - the AWS, S3, CloudFront, SES, SNS and Turnstile values
  - `OPS_ALERT_EMAILS`, `BACKUP_S3_PREFIX`, `OCP_POSTAL_ADDRESS`
  - `RENEWALS_RELEASED=false`, `OPEN_SUBMISSIONS_RELEASED=false`
  - **not** `FEE_TEST_ORDERS` (it lets test orders pay a fee)

  The app doesn't check these at start-up: a missing value only fails when first used.

- [ ] **Hourly cron service** — without it no job runs (nothing expires, no reminders, no page retirement, no lapsed payments, no reconcile, no records purge, and a `shop/redact` request is recorded but never erased). Image `curlimages/curl`, schedule `0 * * * *`, `JOBS_SECRET` (same as the app service) and `APP_URL` set, command:

  ```
  curl -fsS -X POST -H "Authorization: Bearer $JOBS_SECRET" "$APP_URL/jobs/run"
  ```

- [ ] **Nightly backup** job from F08-T2 scheduled.
- [ ] **Migrations**: the deploy runs `prisma migrate deploy` (`npm run docker-start`). Confirm with `npx prisma migrate status` against the production `DATABASE_URL`: every migration applied, including `20261026122617_add_job_run`, `20261027053942_add_job_run_partial`, `20261027061902_audit_event_action_at_index`, `20261027074153_audit_purge_past_retention` (purge trigger and grants), `20261027110016_privacy_erase_markers` (`EmailSuppressionMarker`, `ShopRedactJob`) and `20261027113003_audit_event_at_index` (History index, pinned trigger `search_path`).

## 4. Shopify production app (human)

- [ ] Decide distribution (F08-T3): `app/shopify.server.js` uses `AppDistribution.AppStore`; a custom app for one merchant may move to single-merchant distribution.
- [ ] The production app config has the Railway domain, the scopes, webhooks and app proxy (`apps/classifieds` → `<app URL>/proxy`) from `shopify.app.toml`.
- [ ] Partner Dashboard: **protected customer data access** switched on (needed for `orders/paid`).
- [ ] `shopify app deploy` (pushes config and the theme extension), then install the app on OCP's store and open it in the admin.
- [ ] SNS: create the HTTPS subscription to `https://<app URL>/webhooks/ses` and check it shows **Confirmed** ([ses-setup.md](ses-setup.md) section 4).

## 5. Store set-up (human, in OCP's admin)

- [ ] **Theme** ([theme-install.md](theme-install.md)): listing page template, the **Classifieds** browse page (`/pages/classifieds`, not in the main menu), the noindex app embed on, and the header button snippet.
- [ ] **App settings** (`/app/settings`): staff notification address, fees, deadlines, rules text and email wording checked by OCP.
- [ ] The storefront is **not password-protected** (the one-click unsubscribe POST can't reach the app otherwise).

## 6. Checks before announcing (human, with the agent)

- [ ] `/dev-store-qa e2e` on staging: all 13 steps of [end-to-end-acceptance.md](end-to-end-acceptance.md) pass.
- [ ] Restore the latest dump on staging (`docs/reference/recovery-runbook.md`, F08-T2); forced failures raise one incident email each.
- [ ] Deferred F03-T2 checks: the HEIC-with-GPS fixture test, and on the real bucket `private/` answers 403 while published photos load only through CloudFront.
- [ ] SES checks ([ses-setup.md](ses-setup.md) section 8): DKIM/SPF/DMARC pass, the simulator bounce and complaint land in suppression.
- [ ] Production smoke test:
  - `/jobs/run` without the secret → 401; the cron log shows a 200 JSON summary every hour, and Health shows the last run.
  - A call to an app proxy URL from the storefront loads; a seller link's request log line shows `[redacted]`.
  - One real fee payment (then refund it) is fulfilled silently and doesn't reach ShippingEasy.
  - Privacy webhooks on staging: `shopify app webhook trigger --topic customers/redact` (and `customers/data_request`) answers 200 and writes one `PrivacyErased` (counts only) in History; a `shop/redact` adds a `ShopRedactJob` that the next hourly run completes. Never trigger `shop/redact` against production (it erases everything).
  - History (`/app/history`): filters, paging and CSV export work, and the export shows a `HistoryExported` entry with the staff email.
- [ ] Client sign-off.

## 7. Launch and first week

- [ ] Send the first invitation.
- [ ] Check Health daily for the first week: the last job run, open incidents, email problems. Until F08-T2's incidents exist, also look in History for `PurgeFailed` / `PurgeHeld` / `PageRetireHeld`.
- [ ] Confirm the first reminders and expiries happen on time (they only run from the cron).
- [ ] Phase 2 (renewals) and open submissions stay off until released (`*_RELEASED=false`).
