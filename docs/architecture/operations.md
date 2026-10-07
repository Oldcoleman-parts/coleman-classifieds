# Operations: backups, recovery, retention and problem alerts

## Backups

- **Database:** Railway Postgres automatic daily backups (enable on the OCP plan), plus a nightly `pg_dump` job that uploads an encrypted dump to `s3://<bucket>/backups/db/YYYY-MM-DD.sql.gz.enc` (SSE-KMS). Keep 30 daily copies and 12 monthly copies, controlled by lifecycle rules.
- **Photos:** S3 (11-nines durability) with versioning enabled on `private/` and `public/`, and a lifecycle rule that expires non-current versions after 30 days.
- **Config:** everything else (code, theme extension, email templates seed) lives in GitHub. The email templates in the DB are included in the dump.

## Recovery guide (the full step-by-step goes in `docs/reference/recovery-runbook.md`, written in F08-T2)

1. Create a new Railway Postgres (or restore a Railway backup), or restore the latest S3 dump with `pg_restore`.
2. Set `DATABASE_URL` and redeploy the app service. Run `prisma migrate deploy`.
3. Run `/jobs/run?task=reconcile` to re-sync paid orders, metaobjects and `live_count`.
4. Check the health page (`/app/health`): live listings match the metaobjects, SES is sending, and the last job run succeeded.

## Retention

| Data                                                                                                                                                  | Kept for                              | Then                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------- |
| Photos of closed listings (S3 `private/`)                                                                                                             | 90 days after close                   | deleted                                                       |
| Public photo variants                                                                                                                                 | until close                           | deleted at close                                              |
| Payment records (`FeeCharge`, `ListingPeriod`), agreement records (`TermsAcceptance`), history (`AuditEvent`), buyer messages, seller contact details | **1 year** after close (`purgeAfter`) | deleted (or anonymised where Shopify order links must remain) |
| Metaobject of a closed listing                                                                                                                        | until photo retention ends            | deleted, and a URL redirect goes to the browse page           |
| Fee orders in Shopify                                                                                                                                 | Shopify's own retention               | not touched by the app                                        |

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
