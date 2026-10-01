---
name: shopify-graphql
description: Write or check Shopify Admin or Storefront GraphQL queries and mutations for this app (metaobjects, products, selling plans, discounts, cartCreate, fulfillments, subscription billing). Use before adding any new Shopify API call.
---

# Shopify GraphQL workflow

1. Confirm the API version pinned in `shopify.app.toml`.
2. Use the Shopify Dev MCP server (`.mcp.json`) to introspect the schema and validate the operation. If it's unavailable, check shopify.dev docs for that version.
3. Put operations in the owning module under `services/graphql/*.js` as exported constants. Don't write inline strings in route files.
4. Wrap every mutation with the `platform` helper that throws on `userErrors`.
5. Make sure the required access scope is in `shopify.app.toml`. If a new scope is needed, add it and update `docs/architecture/shopify-config.md`.
6. Add a unit test with a mocked response, including a `userErrors` case.

Operations this app uses: `metaobjectDefinitionCreate`, `metaobjectUpsert`, `metafieldsSet`, `productCreate`/`productVariantsBulkUpdate`, `sellingPlanGroupCreate`, `discountCodeBasicCreate`/`discountCodeDelete`, `fulfillmentCreate`, `storefrontAccessTokenCreate`, `subscriptionBillingAttemptCreate`, `subscriptionContractCancel`, `urlRedirectCreate`, and Storefront `cartCreate`.
