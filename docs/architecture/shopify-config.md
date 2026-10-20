# Shopify configuration and environment

The template already includes the `app/uninstalled` and `app/scopes_update` webhooks and the auth routes. F01-T2 adds the project scopes, webhooks and app proxy below to the existing `shopify.app.toml`, without replacing it.

**Sessions:** `app/shopify.server.js` sets `useOnlineTokens: true` (F02-T1). Admin requests use an online session that carries the logged-in staff user, and `core.staffFromSession()` reads the staff email from it for the audit log. The offline token is still stored and is used by webhooks and jobs.

## 4.1 Access scopes

```
write_metaobject_definitions, write_metaobjects,
write_online_store_navigation,               # redirect of a retired listing page (F06-T2)
write_products,                              # fee product only
write_purchase_options,                      # selling plan for renewals
write_own_subscription_contracts,            # renewals
write_discounts,                             # per-listing single-use codes
write_publications,                          # fee product on Online Store (F06-FIX-1)
read_orders,
write_merchant_managed_fulfillment_orders,   # auto-complete fee orders
read_themes,
unauthenticated_write_checkouts,             # Storefront cartCreate
unauthenticated_read_product_listings
```

**Granted now (F01-T2):** every scope above except `write_purchase_options` and `write_own_subscription_contracts`. Those two are used only by renewals, so they are added with F09 (Phase 2); `write_own_subscription_contracts` may need Shopify’s approval first. `write_publications` was added in F06-FIX-1: the fee product must be on the Online Store channel or the storefront token's carts drop it. It needs a re-auth on the dev store and `shopify app deploy` for production. `write_online_store_navigation` was added in F06-T2 for the redirect `publishing.retireListing()` creates when a closed listing's page is deleted (F08 retention); it needs the same re-auth and deploy.

**Theme app extension (F06-T2):** `extensions/classifieds-theme/` holds the browse and listing blocks and the noindex embed. It is pushed with `shopify app dev` (dev store) or `shopify app deploy`; the merchant then places it as described in `docs/reference/theme-install.md`.

Fee orders are **not tagged** (F06-T1): the fee variant has the SKU `CLASSIFIEDS-FEE` and ShippingEasy excludes by it (`docs/reference/shippingeasy.md`), so `write_orders` is not needed.

The app never reads or writes regular products, inventory or item orders beyond the fee product and fee orders. Confirm subscription API access for a custom app during setup; OCP must use **Shopify Payments** (or a subscription-capable gateway).

## 4.2 Webhooks

`orders/paid`, `refunds/create`, `subscription_contracts/create`, `subscription_billing_attempts/success`, `subscription_billing_attempts/failure`, `app/uninstalled`, plus mandatory privacy webhooks. All handlers **idempotent** (dedupe on webhook id / order id / billing attempt id).

| Topic                                                        | Route                                                      | Handler                                                | Added    |
| ------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------ | -------- |
| `app/uninstalled`, `app/scopes_update`                       | `/webhooks/app/uninstalled`, `/webhooks/app/scopes_update` | template routes                                        | template |
| `orders/paid`                                                | `/webhooks/orders/paid`                                    | payments, via `platform.onWebhook()` (F06)             | F01-T2   |
| `refunds/create`                                             | `/webhooks/refunds/create`                                 | payments, via `platform.onWebhook()` (F06)             | F01-T2   |
| `customers/data_request`, `customers/redact`, `shop/redact`  | `/webhooks/compliance`                                     | platform (audit entry; `shop/redact` deletes sessions) | F01-T2   |
| the three `subscription_*` topics                            | —                                                          | renewals                                               | F09      |
| Amazon SNS (SES bounces and complaints), not a Shopify topic | `/webhooks/ses`                                            | notifications (`handleSesWebhook()`)                   | F03-T1   |

Every non-template route calls `platform.handleWebhook()`: it verifies the HMAC, inserts a `WebhookReceipt` as its claim, calls the topic’s handler, and sets `processedAt` only after the handler succeeded. A repeat delivery returns 200 and does nothing only when the receipt is processed. An unprocessed receipt older than one minute (the process died mid-handler) is taken over and the handler runs again; a newer one means another request is working on it, and the answer is 500 so Shopify retries later. A handler that throws removes its claim and returns 500, and a receipt that can’t be saved also returns 500, never 200. A handler may therefore run twice: every handler must be idempotent and finish well within the minute. `orders/paid` may need protected customer data access switched on for the app in the Partner Dashboard.

`/webhooks/ses` is different: Amazon SNS calls it, so there is no Shopify HMAC. The notifications module verifies the SNS signature, that the signing certificate is on an Amazon SNS host and that the topic is `SNS_TOPIC_ARN`, and answers 403 otherwise. It is not in `shopify.app.toml`; the subscription is created in AWS (`docs/reference/ses-setup.md`).

## 4.3 App proxy

- prefix `apps`, subpath `classifieds` → `https://oldcolemanparts.com/apps/classifieds/...`
- Proxy URL: `<app URL>/proxy`, so `/apps/classifieds/<path>` on the storefront reaches the app at `/proxy/<path>`. Routes are `app/routes/proxy.*`; the catch-all `proxy.$.jsx` returns 404.
- Verify proxy signature on every request (`authenticate.public.appProxy`), through `platform.withAppProxy()`. A missing, wrong or stale signature (older than 90 seconds) gets 401.
- `/apps/classifieds/pay/<ref>` (F06-T1) is the pay page behind the link in the `approved_pay` and `payment_reminder` emails. `<ref>` is `<listingId>.<signature>`, signed with a key derived from `TOKEN_PEPPER`; it stops working when the payment deadline changes. GET shows the fee, POST creates the cart and redirects to the Shopify checkout.
- Seller pages return `noindex, nofollow`; render inside theme layout (Liquid response with `Content-Type: application/liquid`) where practical.

---

```
SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_APP_URL, SCOPES
DATABASE_URL
AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY   # or IAM role
S3_BUCKET, CLOUDFRONT_DOMAIN, CLOUDFRONT_DISTRIBUTION_ID
SES_FROM_TRANSACTIONAL, SES_FROM_ALERTS, SES_CONFIG_SET_TRANSACTIONAL, SES_CONFIG_SET_ALERTS, SNS_TOPIC_ARN
TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY
JOBS_SECRET
SHOP_TIMEZONE               # IANA name for month maths; default America/New_York (confirm with OCP)
TOKEN_PEPPER
RENEWALS_RELEASED           # false until Phase 2
OPEN_SUBMISSIONS_RELEASED   # false until released
OPS_ALERT_EMAILS            # staff + developer addresses for problem alerts
BACKUP_S3_PREFIX
FEE_TEST_ORDERS             # optional: "allow" lets a test order pay a listing fee when NODE_ENV is production (staging on a dev store). Never set it on the live store.
OCP_POSTAL_ADDRESS
SHOP_DOMAIN                 # the store's myshopify.com domain (dev store locally); used for admin links in staff notices, and by payments for Shopify calls outside a request (approval, tasks). Required from F06.
```

The storefront token is not an environment variable: payments creates it with `storefrontAccessTokenCreate` the first time it is needed and stores it encrypted (AES-256-GCM, key derived from `TOKEN_PEPPER`) in `Settings.storefrontTokenEnc`. Rotating `TOKEN_PEPPER` makes it unreadable, and a new one is created on the next use.

## 4.5 Fee product (F06-T1)

Payments creates the fee product the first time it is needed (`ensureFeeSetup()`), or adopts an existing product with the handle `coleman-classifieds-listing-fee`: status **Unlisted**, one variant, SKU `CLASSIFIEDS-FEE`, price = `Settings.baseFeeCents`, not taxed, not physical, stock not tracked. Its ids are kept in `Settings.feeProductGid` and `feeVariantGid`. The selling plan group is created with F09.
