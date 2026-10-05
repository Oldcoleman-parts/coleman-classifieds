import { describe, it, expect, beforeAll } from "vitest";
import { resetDb } from "@/../tests/db.js";
import { mockShopify } from "@/../tests/factories.js";
import { adminGraphql, storefrontGraphql } from "@/modules/platform/index.js";
import { ShopifyUserError } from "@/modules/core/index.js";

describe("GraphQL helpers (SEC: error handling)", () => {
  beforeAll(async () => {
    await resetDb();
  });

  describe("SEC: userErrors are thrown", () => {
    it("SEC: mutation with non-empty userErrors throws ShopifyUserError", async () => {
      const shopify = mockShopify();
      shopify.respondWith({
        metaobjectCreate: {
          userErrors: [
            {
              field: ["type"],
              message: "Type is required",
            },
          ],
        },
      });

      const query = `
        mutation Create($input: MetaobjectInput!) {
          metaobjectCreate(input: $input) {
            userErrors { field message }
          }
        }
      `;

      await expect(adminGraphql(shopify.admin, query, {})).rejects.toThrow(
        ShopifyUserError,
      );
    });

    it("SEC: top-level errors are thrown", async () => {
      const shopify = mockShopify();
      shopify.admin.graphql.mockResolvedValueOnce({
        json: async () => ({
          errors: [
            {
              message: "Invalid query",
              extensions: { code: "GRAPHQL_SYNTAX_ERROR" },
            },
          ],
        }),
      });

      const query = `query { invalid }`;

      await expect(adminGraphql(shopify.admin, query)).rejects.toThrow(
        ShopifyUserError,
      );
    });

    it("SEC: storefront query with customerUserErrors throws", async () => {
      const shopify = mockShopify();
      shopify.storefront.graphql.mockResolvedValueOnce({
        json: async () => ({
          data: {
            checkoutCreate: {
              checkout: null,
              customerUserErrors: [
                {
                  field: ["email"],
                  message: "Email is invalid",
                },
              ],
            },
          },
        }),
      });

      const query = `mutation { checkoutCreate { customerUserErrors } }`;

      await expect(
        storefrontGraphql(shopify.storefront, query),
      ).rejects.toThrow(ShopifyUserError);
    });
  });

  describe("AC: Clean responses return data", () => {
    it("AC: mutation without userErrors returns data", async () => {
      const shopify = mockShopify();
      shopify.respondWith({
        metaobjectCreate: {
          metaobject: {
            id: "gid://shopify/Metaobject/123",
            type: "classifieds_listing",
          },
          userErrors: [],
        },
      });

      const query = `mutation { metaobjectCreate { metaobject { id type } } }`;

      const data = await adminGraphql(shopify.admin, query);
      expect(data.metaobjectCreate.metaobject.id).toBe(
        "gid://shopify/Metaobject/123",
      );
    });

    it("AC: query without errors returns data", async () => {
      const shopify = mockShopify();
      shopify.respondWith({
        shop: {
          name: "Test Shop",
        },
      });

      const query = `query { shop { name } }`;

      const data = await adminGraphql(shopify.admin, query);
      expect(data.shop.name).toBe("Test Shop");
    });

    it("AC: storefront query returns data", async () => {
      const shopify = mockShopify();
      shopify.storefront.graphql.mockResolvedValueOnce({
        json: async () => ({
          data: {
            product: {
              id: "gid://shopify/Product/456",
              title: "Test Product",
            },
          },
        }),
      });

      const query = `query { product { id title } }`;

      const data = await storefrontGraphql(shopify.storefront, query);
      expect(data.product.title).toBe("Test Product");
    });
  });
});
