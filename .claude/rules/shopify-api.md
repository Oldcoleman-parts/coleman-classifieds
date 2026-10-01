---
paths:
  - "app/modules/platform/**"
  - "app/modules/payments/**"
  - "app/modules/publishing/**"
  - "app/routes/webhooks.*"
  - "shopify.app.toml"
---

# Shopify API rules

- Use the Admin GraphQL API at the version pinned in `shopify.app.toml`. Don't use REST.
- Every mutation must check `userErrors` and throw a custom error (e.g. `ShopifyUserError`) when it isn't empty.
- Before writing a new query or mutation, check it against the current schema (Shopify Dev MCP server, or the `/shopify-graphql` skill). Don't guess field names.
- Listings are **metaobjects**, never products. The only product the app creates is the hidden fee product.
- Fee orders are identified by the cart attribute `_classifieds_listing_id`. Ignore orders without it.
- Webhook handlers return 200 quickly, dedupe by webhook ID, and do heavy work after acknowledging.
- Use the smallest set of access scopes. Only add a scope when a ticket requires it, and update `docs/architecture/shopify-config.md` when you do.
- Fee orders: `requiresShipping=false`, fulfilled immediately with `notifyCustomer: false`, tagged `coleman-classifieds-fee`. They must never appear in ShippingEasy, the packing queue or shipping notifications.
