// Storefront API 2026-07, called with the app's own storefront token.
// Scope: unauthenticated_write_checkouts.
export const CART_CREATE = `#graphql
  mutation FeeCartCreate($input: CartInput!) {
    cartCreate(input: $input) {
      cart {
        id
        checkoutUrl
        totalQuantity
        cost {
          totalAmount {
            amount
            currencyCode
          }
        }
        discountCodes {
          code
          applicable
        }
      }
      userErrors {
        field
        code
        message
      }
    }
  }
`;
