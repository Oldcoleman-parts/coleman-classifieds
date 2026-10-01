# Shopify configuration and environment

The template already includes the `app/uninstalled` and `app/scopes_update` webhooks and the auth routes. F01-T2 adds the project scopes, webhooks and app proxy below to the existing `shopify.app.toml`, without replacing it.

## 4.1 Access scopes

```
write_metaobject_definitions, write_metaobjects,
write_products,                              # fee product only
write_purchase_options,                      # selling plan for renewals
write_own_subscription_contracts,            # renewals
write_discounts,                             # per-listing single-use codes
read_orders,
write_merchant_managed_fulfillment_orders,   # auto-complete fee orders
read_themes,
unauthenticated_write_checkouts,             # Storefront cartCreate
unauthenticated_read_product_listings
```

The app never reads or writes regular products, inventory or item orders beyond the fee product and fee orders. Confirm subscription API access for a custom app during setup; OCP must use **Shopify Payments** (or a subscription-capable gateway).

## 4.2 Webhooks

`orders/paid`, `refunds/create`, `subscription_contracts/create`, `subscription_billing_attempts/success`, `subscription_billing_attempts/failure`, `app/uninstalled`, plus mandatory privacy webhooks. All handlers **idempotent** (dedupe on webhook id / order id / billing attempt id).

## 4.3 App proxy

- prefix `apps`, subpath `classifieds` → `https://oldcolemanparts.com/apps/classifieds/...`
- Verify proxy signature on every request (`authenticate.public.appProxy`).
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
TOKEN_PEPPER
RENEWALS_RELEASED           # false until Phase 2
OPEN_SUBMISSIONS_RELEASED   # false until released
OPS_ALERT_EMAILS            # staff + developer addresses for problem alerts
BACKUP_S3_PREFIX
STOREFRONT_ACCESS_TOKEN   # created by app via storefrontAccessTokenCreate at install; may be stored in DB instead
OCP_POSTAL_ADDRESS
```
