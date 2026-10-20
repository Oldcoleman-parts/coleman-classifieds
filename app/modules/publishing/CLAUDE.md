# Module `publishing` — part of F06 Payments and publishing

The storefront side of F06: each listing's metaobject page, the browse and listing theme blocks, and the `live_count` behind the header button.

- **Spec and tickets:** `docs/features/06-payments-and-publishing/`
- **Security skill:** `security-publishing` (loads automatically when you edit this module; audits are on demand).
- **Events:** Payments listens to `ListingApproved` and `ListingClosed`, and publishes `PaymentReceived`. Publishing listens to `ListingWentLive`, `ListingUpdatedImmediate`, `RevisionApproved`, `ListingPaused`/`Resumed`, `ListingExtended` and `ListingClosed`.

## Rules for this feature

- Nothing is charged before approval; payment of an approved listing publishes it; `expiresAt = addMonths(liveAt, 1)`.
- Listings are metaobjects, never products; no Add to Cart; private-seller badge and disclaimer always shown; the **header button** sits beside Search/Account/Cart (first in the mobile drawer), never in the menu row.

## How it is built (F06-T2)

- Core moves the listing to LIVE on `PaymentReceived`; publishing only reacts to `ListingWentLive` and the other events. Payments records the `ListingPeriod` (`payments/services/periods.js`).
- `services/sync.js` `syncListing()` writes the page from the database: LIVE → full fields, ACTIVE; PAUSED/PAYMENT_OVERDUE → DRAFT; closed after being live → `closedFields()` (title + `closed` only), still ACTIVE so the address shows "no longer available". It calls `media.publish()` before the upsert. Safe to repeat.
- `services/fields.js` is the **whitelist**: only `PUBLIC_KEYS` are written; `seller_display` is one word or "Private seller"; photos must be on `https://$CLOUDFRONT_DOMAIN/`. Never add a key without checking it can't hold PII.
- `services/definition.js` creates the `classified_listing` definition and the `classifieds.live_count` metafield definition on first use. `live_count` is computed from the database only (`services/live-count.js`).
- `services/emails.js`: `listing_live` (sensitive, three tries an hour apart, key `listing_live:<id>:<liveAt>:<k>`, links to Get my link, never the private link) and `revision_approved` (key `revision_approved:<revisionId>`).
- Event handlers never throw; problems go to `services/problems.js` `reportPublishingProblem()` (F08-T2 turns it into a PUBLISHING incident). The hourly `publishing.reconcile` re-syncs open and recently closed pages, retries `listing_live` and sets the count.
- `retireListing()` (F08-T1 calls it at photo retention): redirect `/pages/classified-listing/<handle>` → `/pages/classifieds`, then delete the entry.
- `services/facts.js` is the only reader of `Listing`; publishing writes only `metaobjectGid` and `metaobjectHandle` (handle set once at first go-live).
- Storefront: `extensions/classifieds-theme/` (browse block, listing block, noindex embed; every field `| escape`), `theme-snippets/classifieds-header-button.liquid`, install steps in `docs/reference/theme-install.md`.
- Tests use `setOfflineAdmin()`, `resetDefinitionCache()` and `resetPublishingProblems()`.

## Boundaries

- Export only through `index.js`. Never import other modules’ `services/`; use their `index.js` or events.
- Status changes go through `core` `transition()`.
