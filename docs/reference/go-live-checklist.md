# Go-live checklist

Everything that has to happen before (and just after) Coleman Classifieds goes live on oldcolemanparts.com, in order. Each step links to the guide that has the details. Steps marked **(human)** are done by a person: deploys, production migrations, `git push` and account set-up are never done by the agent.

Tick the boxes in a copy of this list (or in F08-T2's Notes) as you go.

## 1. Finish the code (agent, with `/implement-ticket`)

- [x] Open fix tickets: none open after F08-FIX-4 (re-run `/review-all` on the fixes so `openCriticalHigh` is 0).
- [ ] [F08-T4](../features/08-operations-and-launch/tickets/F08-T4.md) records purge, and [F08-T5](../features/08-operations-and-launch/tickets/F08-T5.md) privacy redact erasure (launch-blocking: Shopify's `customers/redact` and `shop/redact` must really erase).
- [ ] [F08-T3](../features/08-operations-and-launch/tickets/F08-T3.md) hosting (section 3 below), then [F08-T2](../features/08-operations-and-launch/tickets/F08-T2.md) backups, `ops.raiseIncident()`, the watchdog and the recovery runbook.
- [ ] `/review-all` on everything since the last checkpoint. Every launch feature must be in `docs/reviews/review-log.json` with no open Critical or High findings.
- [ ] `npm run test:ai` green, and CI green on GitHub.

## 2. Accounts and services (human)

- [ ] **Amazon SES** ([ses-setup.md](ses-setup.md)): verify the sending domain (DKIM, custom MAIL FROM, DMARC), create the two configuration sets and the SNS topic, and **request production access early** (about a day; the sandbox only sends to verified addresses). Create the app's credentials.
- [ ] **S3 and CloudFront** ([s3-cloudfront-setup.md](s3-cloudfront-setup.md)): the bucket with versioning and lifecycle rules, CORS, the distribution reading `public/` only, and the app's IAM user.
- [ ] **Backups bucket**: an SSE-KMS prefix (`BACKUP_S3_PREFIX`) for the nightly `pg_dump`, with 30 daily and 12 monthly copies (F08-T2, [operations.md](../architecture/operations.md)).
- [ ] **Cloudflare Turnstile**: a site for oldcolemanparts.com; note the site and secret keys.
- [ ] **Shopify Payments** is on for OCP's store (checkout for the listing fee).
- [ ] **ShippingEasy** ([shippingeasy.md](shippingeasy.md)): the rule that doesn't import orders with SKU `CLASSIFIEDS-FEE`.
- [ ] A password manager entry for `TOKEN_PEPPER` and `JOBS_SECRET` (losing or changing `TOKEN_PEPPER` breaks every seller link and device sign-in).

## 3. Railway production (human, [railway-setup.md](railway-setup.md))

- [ ] OCP-owned Railway project with **PostgreSQL (daily backups on)** and the **app service** from GitHub. The database user must be allowed to create roles (the first migration creates `classifieds_purge`).
- [ ] **Every environment variable** from [shopify-config.md](../architecture/shopify-config.md) set on the app service, with production values:
  - `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES` (the production app's)
  - `DATABASE_URL`, `SHOP_DOMAIN` (OCP's `*.myshopify.com`), `SHOP_TIMEZONE` (confirm with OCP)
  - `TOKEN_PEPPER`, `JOBS_SECRET`: new long random values, **different from staging**
  - the AWS, S3, CloudFront, SES, SNS and Turnstile values
  - `OPS_ALERT_EMAILS`, `BACKUP_S3_PREFIX`, `OCP_POSTAL_ADDRESS`
  - `RENEWALS_RELEASED=false`, `OPEN_SUBMISSIONS_RELEASED=false`
  - **not** `FEE_TEST_ORDERS` (it lets test orders pay a fee)

  The app doesn't check these at start-up: a missing value only fails when first used.

- [ ] **Hourly cron service** — without it no job runs (nothing expires, no reminders, no page retirement, no lapsed payments, no reconcile). Image `curlimages/curl`, schedule `0 * * * *`, `JOBS_SECRET` (same as the app service) and `APP_URL` set, command:

  ```
  curl -fsS -X POST -H "Authorization: Bearer $JOBS_SECRET" "$APP_URL/jobs/run"
  ```

- [ ] **Nightly backup** job from F08-T2 scheduled.
- [ ] **Migrations**: the deploy runs `prisma migrate deploy` (`npm run docker-start`). Confirm with `npx prisma migrate status` against the production `DATABASE_URL`: every migration applied, including `20261026122617_add_job_run`, `20261027053942_add_job_run_partial`, `20261027061902_audit_event_action_at_index` (and the F08-T4 migration once built).

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
- [ ] Client sign-off.

## 7. Launch and first week

- [ ] Send the first invitation.
- [ ] Check Health daily for the first week: the last job run, open incidents, email problems.
- [ ] Confirm the first reminders and expiries happen on time (they only run from the cron).
- [ ] Phase 2 (renewals) and open submissions stay off until released (`*_RELEASED=false`).
