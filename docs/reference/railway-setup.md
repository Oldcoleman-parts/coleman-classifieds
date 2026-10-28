# Railway setup (staging and production)

Hosting is an **OCP-owned** Railway project. These steps are done by a human; the repo provides `Dockerfile`, `railway.json` and `shopify.app.staging.toml`.

## 1. Project and services

1. Create the Railway project under OCP’s account.
2. Add a **PostgreSQL** service. Turn on daily backups.
3. Add an **app service** from the GitHub repo. Railway picks up `railway.json`: it builds the `Dockerfile` and starts with `npm run docker-start`, which runs `prisma generate && prisma migrate deploy` and then `npm run start` (the app’s own Express server, `app/modules/platform/server/start.js`).
4. Generate a public domain for the app service.

The initial migration creates the `classifieds_purge` database role, so the database user in `DATABASE_URL` must be allowed to create roles (Railway’s default `postgres` user is). If the first deploy fails in `prisma migrate deploy` with a permission error, this is the cause.

## 2. Environment variables (app service)

| Variable                                                           | Value                                                          |
| ------------------------------------------------------------------ | -------------------------------------------------------------- |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`                            | from the staging app in the Partner dashboard                  |
| `SHOPIFY_APP_URL`                                                  | `https://<railway-domain>`                                     |
| `SCOPES`                                                           | the same list as `scopes` in `shopify.app.staging.toml`        |
| `DATABASE_URL`                                                     | `${{Postgres.DATABASE_URL}}`                                   |
| `TOKEN_PEPPER`, `JOBS_SECRET`                                      | long random values, different per environment                  |
| `SHOP_TIMEZONE`                                                    | OCP’s timezone as an IANA name, e.g. `America/New_York`        |
| `RENEWALS_RELEASED`, `OPEN_SUBMISSIONS_RELEASED`                   | `false`                                                        |
| AWS, SES, CloudFront, Turnstile, `OPS_ALERT_EMAILS`, backup values | added with F03, F07 and F08 (`architecture/shopify-config.md`) |

## 3. Hourly cron

Add a cron service (image `curlimages/curl`), schedule `0 * * * *`, with `JOBS_SECRET` and `APP_URL` set:

```
curl -fsS -X POST -H "Authorization: Bearer $JOBS_SECRET" "$APP_URL/jobs/run"
```

`/jobs/run` exists since F01-T2. It answers 401 without the secret and a JSON summary with it.

## 4. Staging Shopify app

1. Create a separate app, “Coleman Classifieds (staging)”, so its URLs never clash with the ones `shopify app dev` rewrites on the dev app.
2. In `shopify.app.staging.toml`, set `client_id` and replace `REPLACE_WITH_RAILWAY_DOMAIN` (four places).
3. `shopify app deploy --config staging`
4. Install the staging app on the dev store and open it. The embedded shell should load.

## 5. Check

- The deploy log shows both migrations applied.
- The app opens embedded in the dev store admin.
- A `Session` row exists in the Railway database.
- Open a seller link, then read the app service log: the request lines show `[redacted]` in place of the token and contain no `?`.
