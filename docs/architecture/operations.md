# Operations: backups, recovery, retention and problem alerts

## Backups

- **Database:** Railway Postgres automatic daily backups (enable on the OCP plan), plus a nightly `pg_dump` job that uploads an encrypted dump to `s3://<bucket>/backups/db/YYYY-MM-DD.sql.gz.enc` (SSE-KMS). Keep 30 daily copies and 12 monthly copies, controlled by lifecycle rules.
- **Photos:** S3 (11-nines durability) with versioning enabled on `private/` and `public/`, and a lifecycle rule that expires non-current versions after 30 days.
- **Config:** everything else (code, theme extension, email templates seed) lives in GitHub. The email templates in the DB are included in the dump.

## Recovery guide (the full step-by-step goes in `docs/reference/recovery-runbook.md`, written in F08-T2)

1. Create a new Railway Postgres (or restore a Railway backup), or restore the latest S3 dump with `pg_restore`.
2. Set `DATABASE_URL` and redeploy the app service. Run `prisma migrate deploy`.
3. Run `/jobs/run?task=payments.reconcile-paid-orders` to record paid fee orders whose webhook was lost (it looks back over the payment window plus 3 days, at most 59 days: the `read_orders` limit; check older orders in Shopify admin), then `/jobs/run?task=publishing.reconcile` to re-sync metaobjects and `live_count`. A lapse run that couldn't reach Shopify lapses nothing and reports `lapse-skipped` (F06-FIX-3). `?task=` takes any registered task name and can be repeated; an unknown name is refused (400). Each run's summary is stored in `JobRun` for 30 days, and Health shows the last one (F08-T1).
4. Check the health page (`/app/health`): live listings match the metaobjects, SES is sending, and the last job run succeeded.

## Retention

| Data                                                                                                                                                  | Kept for                                                                                                             | Then                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Photos of closed listings (S3 `private/`)                                                                                                             | 90 days after close                                                                                                  | deleted                                                                                                                                                                                                                                               |
| Public photo variants                                                                                                                                 | until close                                                                                                          | deleted at close                                                                                                                                                                                                                                      |
| Payment records (`FeeCharge`, `ListingPeriod`), agreement records (`TermsAcceptance`), history (`AuditEvent`), buyer messages, seller contact details | **1 year** after close (`purgeAfter`)                                                                                | deleted by the hourly `ops.purge-records` (F08-T4), at most 50 listings a run, once photos are deleted and the storefront page is retired; listing-less history rows past `recordsRetentionDays`, except the rules wording a kept agreement refers to |
| Metaobject of a closed listing                                                                                                                        | until photo retention ends                                                                                           | deleted, and a URL redirect goes to the browse page                                                                                                                                                                                                   |
| Alert subscribers (`AlertSubscriber`, F07-T2)                                                                                                         | unconfirmed: 30 days; unsubscribed: kept as the opt-out record, except after a privacy redact, which deletes the row | unconfirmed rows deleted by `alerts.housekeeping`                                                                                                                                                                                                     |
| Alert queue (`AlertQueue`)                                                                                                                            | 90 days after it was sent                                                                                            | deleted                                                                                                                                                                                                                                               |
| Fee orders in Shopify                                                                                                                                 | Shopify's own retention                                                                                              | not touched by the app                                                                                                                                                                                                                                |

## Logs

The production server (`app/modules/platform/server/`, F01-FIX-7) writes one line per request to the Railway logs: method, path, status and duration, for example `GET /proxy/seller/[redacted]/draft 200 12ms`.

- A seller link works like a password, so the line never contains the seller token, a query string (app proxy signature, emails), a header, an IP address or a user agent.
- Error lines follow the same rule: the error name or status and the redacted path.
- Never set the Shopify library's log level to debug in production. At that level it prints every request parameter.
- Logs written before this fix was deployed may contain seller links. Clear them, or re-issue the open links.

## Problem alerts (`OpsIncident`)

Raised by modules through `ops.raiseIncident(key, kind, message, details)`. They're de-duplicated by `key`, and the first occurrence emails `OPS_ALERT_EMAILS` (staff + developer). A daily summary covers any still open.

| Kind       | Examples                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| PAYMENT    | a paid fee order with no matching listing; a late payment on a lapsed listing; a refund on a fee order |
| PUBLISHING | a metaobject upsert or publish failed; a photo publish failed; `live_count` drift                      |
| EMAIL      | SES send failures; bounce rate > 5% or complaint rate > 0.1% (24h); SNS handler errors                 |
| JOB        | a scheduled task failed twice in a row; the job hasn't run for 3 hours or more (watchdog)              |
| BACKUP     | the nightly dump failed or is missing                                                                  |

Staff see open incidents on `/app/health` and can mark them resolved.

## Privacy redact (F08-T5, F08-FIX-8)

- `customers/redact` and `shop/redact` anonymise or delete the seller, buyer and subscriber rows and the emails to that address, close the seller's open listings (`PRIVACY_REDACTED`, no email) and blank the listing's display name and location. Fee charges, photos and audit rows follow their normal retention.
- A suppressed address that is erased keeps an `EmailSuppressionMarker` (`sha256(email + TOKEN_PEPPER)`, no plain email, no end date), so it stays suppressed. Rotating `TOKEN_PEPPER` makes these markers stop matching (accepted).
- `shop/redact` is a `ShopRedactJob` row run by the hourly `ops.shop-redact` task; done rows have no retention rule yet.
