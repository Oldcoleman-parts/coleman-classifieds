# Local setup

The app is the `shopify app init` React Router template, extended. It needs **PostgreSQL** (the template’s SQLite database is no longer used).

## Prerequisites

- Node 22 (`>=22.12`)
- Docker (for the local database), or a Railway dev database
- Shopify CLI access to the dev store

## First run

1. Start the database: `docker compose up -d db` (PostgreSQL 16 on port 5432). If that port is taken, set `POSTGRES_PORT` (for example `POSTGRES_PORT=5433 docker compose up -d db`) and use the same port in the URLs below.
2. Create `.env` in the project root with at least:

   ```
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/classifieds_dev
   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/classifieds_test
   TOKEN_PEPPER=<any long random string>
   JOBS_SECRET=<any long random string>
   SHOP_TIMEZONE=America/New_York
   RENEWALS_RELEASED=false
   OPEN_SUBMISSIONS_RELEASED=false
   ```

   The full variable list is in `docs/architecture/shopify-config.md`. `shopify app dev` supplies the Shopify variables itself. Never commit `.env`.

3. `npm install`
4. `npm run setup` (generates the Prisma client and applies the migrations).
5. `npm run dev`, then open the app from the dev store admin.

**The database must be running before `npm run dev`**, because the dev command applies migrations first (`shopify.web.toml`).

The first time the app is opened after moving to PostgreSQL, the `Session` table is empty, so the app re-authenticates. Nothing else needs doing; reinstall the app only if that fails.

## Tests

- `npm run test:ai` prints one line when everything passes. `npm test` gives the full output.
- Tests use the database in `TEST_DATABASE_URL` (default: `classifieds_test` on the local Postgres). It’s created and migrated automatically at the start of a run, and **every table is emptied** by the tests.
- The test run refuses any database whose name doesn’t end in `_test`. Never point `TEST_DATABASE_URL` at a shared or hosted database.
- The test database user must be a superuser (the Docker database user is): the audit log blocks `TRUNCATE`, and the test reset switches triggers off to clear it.

## Schema changes

Use `/schema-change`: edit `docs/architecture/data-model.md`, mirror it in `prisma/schema.prisma`, then run `npx prisma migrate dev --name <snake_case>`. Never edit an applied migration.

The database user that applies migrations needs permission to create roles: the initial migration creates the `classifieds_purge` role used by the retention purge.

## Using a Railway dev database instead of Docker

Create a Postgres service in a personal Railway project and put its public connection URL in `DATABASE_URL`. Keep `TEST_DATABASE_URL` on a local database: tests wipe whatever they connect to.
