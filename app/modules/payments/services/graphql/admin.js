// Admin API 2026-07 (the version pinned in `app/shopify.server.js`). Checked against the
// shopify.dev Admin reference; the Dev MCP server wasn't available here. Every operation is
// run through `platform.adminGraphql()`, which throws on `userErrors`.

// Scope: read_products.
export const FEE_PRODUCT_BY_HANDLE = `#graphql
  query FeeProductByHandle($handle: String!) {
    productByIdentifier(identifier: { handle: $handle }) {
      id
      variants(first: 2) {
        nodes {
          id
        }
      }
    }
  }
`;

// Scope: write_products. An UNLISTED product is hidden from search, collections, the
// sitemap and feeds, and can still be bought when it is put in a cart by id.
export const FEE_PRODUCT_CREATE = `#graphql
  mutation FeeProductCreate($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product {
        id
        variants(first: 2) {
          nodes {
            id
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// Scope: write_products. Sets the price, the SKU, no shipping and no stock tracking.
export const FEE_VARIANT_UPDATE = `#graphql
  mutation FeeVariantUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
      }
      userErrors {
        field
        code
        message
      }
    }
  }
`;

// Scope: unauthenticated_* (the token gets the app's unauthenticated scopes).
export const STOREFRONT_TOKEN_CREATE = `#graphql
  mutation FeeStorefrontTokenCreate($input: StorefrontAccessTokenInput!) {
    storefrontAccessTokenCreate(input: $input) {
      storefrontAccessToken {
        accessToken
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// Scope: write_discounts.
export const DISCOUNT_CREATE = `#graphql
  mutation FeeDiscountCreate($discount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $discount) {
      codeDiscountNode {
        id
      }
      userErrors {
        field
        code
        message
      }
    }
  }
`;

// Scope: read_discounts (included in write_discounts).
export const DISCOUNT_BY_CODE = `#graphql
  query FeeDiscountByCode($code: String!) {
    codeDiscountNodeByCode(code: $code) {
      id
    }
  }
`;

// Scope: write_discounts.
export const DISCOUNT_DELETE = `#graphql
  mutation FeeDiscountDelete($id: ID!) {
    discountCodeDelete(id: $id) {
      deletedCodeDiscountId
      userErrors {
        field
        code
        message
      }
    }
  }
`;

// Scopes: read_orders, read_merchant_managed_fulfillment_orders (included in write_…).
export const ORDER_FULFILMENT_STATE = `#graphql
  query FeeOrderFulfilmentState($id: ID!) {
    order(id: $id) {
      id
      displayFulfillmentStatus
      fulfillmentOrders(first: 5) {
        nodes {
          id
          status
        }
      }
    }
  }
`;

// Scope: write_merchant_managed_fulfillment_orders. `notifyCustomer` is always false.
export const FULFILMENT_CREATE = `#graphql
  mutation FeeFulfilmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;
