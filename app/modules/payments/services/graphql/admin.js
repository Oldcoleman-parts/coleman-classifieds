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

// Scope: read_products. The live price of the fee variant (F06-FIX-1).
export const FEE_VARIANT_PRICE = `#graphql
  query FeeVariantPrice($id: ID!) {
    productVariant(id: $id) {
      id
      price
      product {
        id
      }
    }
  }
`;

// Scope: read_publications (included in write_publications). The sales channels; the fee
// product goes on Online Store, the channel the storefront token's carts use (F06-FIX-1).
export const FEE_PUBLICATIONS = `#graphql
  query FeePublications {
    publications(first: 25) {
      nodes {
        id
        catalog {
          title
        }
      }
    }
  }
`;

// Scope: write_publications. Publishing to a channel doesn't change the UNLISTED status, and
// publishing an already published product changes nothing.
export const FEE_PUBLISH = `#graphql
  mutation FeePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors {
        field
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
      codeDiscount {
        ... on DiscountCodeBasic {
          customerGets {
            value {
              ... on DiscountAmount {
                amount {
                  amount
                }
              }
            }
          }
        }
      }
    }
  }
`;

// Scope: read_discounts. The amount of the listing's code (F06-FIX-1).
export const DISCOUNT_AMOUNT = `#graphql
  query FeeDiscountAmount($id: ID!) {
    codeDiscountNode(id: $id) {
      id
      codeDiscount {
        ... on DiscountCodeBasic {
          customerGets {
            value {
              ... on DiscountAmount {
                amount {
                  amount
                }
              }
            }
          }
        }
      }
    }
  }
`;

// Scope: write_discounts. Changes the amount of an existing code; the code, its usage limit
// and its end date stay as they were.
export const DISCOUNT_UPDATE = `#graphql
  mutation FeeDiscountUpdate($id: ID!, $discount: DiscountCodeBasicInput!) {
    discountCodeBasicUpdate(id: $id, basicCodeDiscount: $discount) {
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
