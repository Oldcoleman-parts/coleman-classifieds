// Admin API 2026-10. `Shop.primaryDomain.url` (Domain.url: URL!) needs no extra scope.
// Checked against the shopify.dev Admin reference; the Dev MCP server wasn't available here.
export const SHOP_PRIMARY_DOMAIN = `#graphql
  query ShopPrimaryDomain {
    shop {
      primaryDomain {
        url
      }
    }
  }
`;
