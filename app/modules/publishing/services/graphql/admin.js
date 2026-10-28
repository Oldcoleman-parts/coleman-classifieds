// Admin API 2026-07 (the version pinned in `app/shopify.server.js`). Checked against the
// shopify.dev Admin reference; the Dev MCP server wasn't available here. Every operation is
// run through `platform.adminGraphql()`, which throws on `userErrors`.

// Scope: read_metaobject_definitions (implied by write_).
export const LISTING_DEFINITION = `#graphql
  query ListingDefinition($type: String!) {
    metaobjectDefinitionByType(type: $type) {
      id
      fieldDefinitions {
        key
      }
    }
  }
`;

// Scope: write_metaobject_definitions. Publishable (ACTIVE/DRAFT) and with its own web page
// at /pages/<urlHandle>/<handle>, readable by the storefront.
export const LISTING_DEFINITION_CREATE = `#graphql
  mutation ListingDefinitionCreate($definition: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $definition) {
      metaobjectDefinition {
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

// Scope: write_metaobject_definitions. Adds fields an older definition is missing.
export const LISTING_DEFINITION_UPDATE = `#graphql
  mutation ListingDefinitionUpdate($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
    metaobjectDefinitionUpdate(id: $id, definition: $definition) {
      metaobjectDefinition {
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

// Scope: write_metaobjects. Creates the entry or replaces the given fields, by handle; keys
// left out keep their values, so every key is always sent. New entries start as DRAFT.
export const LISTING_UPSERT = `#graphql
  mutation ListingUpsert($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
    metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
      metaobject {
        id
        handle
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

// Scope: write_metaobjects.
export const LISTING_DELETE = `#graphql
  mutation ListingDelete($id: ID!) {
    metaobjectDelete(id: $id) {
      deletedId
      userErrors {
        field
        message
        code
      }
    }
  }
`;

// Scope: read_metaobjects. What the storefront shows: entries that are ACTIVE and live.
export const LISTING_ENTRIES = `#graphql
  query ListingEntries($type: String!, $after: String) {
    metaobjects(type: $type, first: 250, after: $after) {
      nodes {
        capabilities {
          publishable {
            status
          }
        }
        field(key: "public_status") {
          value
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// The shop's id, currency and current live count.
export const SHOP_LIVE_COUNT = `#graphql
  query ShopLiveCount($namespace: String!, $key: String!) {
    shop {
      id
      currencyCode
      metafield(namespace: $namespace, key: $key) {
        value
      }
    }
  }
`;

// Scope: shop metafield definitions (expected with the app's metaobject scopes; to check on
// the dev store). Makes `shop.metafields.classifieds.live_count` readable by the storefront.
export const LIVE_COUNT_DEFINITION_CREATE = `#graphql
  mutation LiveCountDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
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

export const LIVE_COUNT_SET = `#graphql
  mutation LiveCountSet($metafields: [MetafieldsSetInput!]!) {
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

// Scope: read_online_store_navigation (implied by write_).
export const REDIRECT_BY_PATH = `#graphql
  query RedirectByPath($query: String!) {
    urlRedirects(first: 1, query: $query) {
      nodes {
        id
        path
      }
    }
  }
`;

// Scope: write_online_store_navigation.
export const REDIRECT_CREATE = `#graphql
  mutation RedirectCreate($urlRedirect: UrlRedirectInput!) {
    urlRedirectCreate(urlRedirect: $urlRedirect) {
      urlRedirect {
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
