// Admin GraphQL for the alerts module: the shop metafield that shows or hides the signup.

// The shop's id and whether the storefront currently shows the signup.
export const SHOP_ALERTS_FLAG = `#graphql
  query ShopAlertsFlag($namespace: String!, $key: String!) {
    shop {
      id
      metafield(namespace: $namespace, key: $key) {
        value
      }
    }
  }
`;

// Scope: none beyond the app's own (shop metafields in the app's namespace, as live_count).
export const ALERTS_FLAG_SET = `#graphql
  mutation AlertsFlagSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;
