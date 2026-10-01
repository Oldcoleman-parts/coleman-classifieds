# Coleman Classifieds — agent guide

A custom Shopify app for **Old Coleman Parts (OCP)** (oldcolemanparts.com): an **invite-only, paid, staff-approved private-seller classifieds** section.

**Starting point:** created with `shopify app init` (React Router template), running on the dev store. Extend the template, never re-scaffold (`.claude/rules/03-existing-template-app.md`).

Staff invite a seller with a private one-listing link. The seller prepares the listing, staff approve it, and the seller pays through OCP’s Shopify checkout. The listing is then live for **one calendar month**, and buyers contact the seller through a private email relay. OCP only sells advertising space. Listings are **Shopify metaobjects, never products**.

## Features

| #   | Feature                  | Tickets | Module(s)                       | Phase |
| --- | ------------------------ | ------- | ------------------------------- | ----- |
| 01  | Foundation and platform  | 2       | `platform`, `core`, `scheduler` | 1     |
| 02  | Email and photo services | 2       | `notifications`, `media`        | 1     |
| 03  | Seller journey           | 2       | `access`, `workspace`           | 1     |
| 04  | Staff console            | 2       | `console`                       | 1     |
| 05  | Payments and publishing  | 2       | `payments`, `publishing`        | 1     |
| 06  | Buyer contact and alerts | 2       | `contact`, `alerts`             | 1     |
| 07  | Operations and launch    | 2       | `scheduler`, `ops`              | 1     |
| 08  | Automatic renewals       | 2       | `payments/renewals`             | 2     |
| 09  | Open submissions         | 1       | `access/public`                 | Later |

Specs and tickets: `docs/features/<NN>-<name>/`. Module memory: `app/modules/<module>/CLAUDE.md`. Status and build order: `docs/README.md`. **Work on one feature and one ticket at a time.**

## Source-of-truth documents

- `docs/product/overview.md`: goals, listing rules, agreed decisions, phases
- `docs/architecture/architecture.md`: stack, modules, layout, account ownership
- `docs/architecture/data-model.md`: **the only** schema and state machine definition
- `docs/architecture/events.md`: event contract
- `docs/architecture/shopify-config.md`: scopes, webhooks, app proxy, env vars
- `docs/architecture/operations.md`: backups, recovery, retention, problem alerts

## Non-negotiables

1. Every listing status change goes through `core/lifecycle.transition()`.
2. Modules talk only through events or another module’s `index.ts`.
3. Nothing is charged before staff approval; payment of an approved listing publishes it; the listing period is `addMonths(liveAt, 1)`.
4. Public output never contains the seller’s email, phone, last name or street address; photos are stripped of EXIF/GPS.
5. Tokens and codes are hashed, compared in constant time, and never logged.
6. Webhooks and jobs are idempotent.
7. Phase 2 and later features stay behind flags and remain hidden until released.
8. Build only what’s in the current ticket’s scope.

## Commands

- `npm run dev` runs `shopify app dev`
- `npm run test:ai` is the **compact test output (always use this one)**; `npm test` gives full output for humans
- `npm run lint` · `npx prisma migrate dev --name <name>`
- Deploys, production migrations and `git push` are done by a human only.
