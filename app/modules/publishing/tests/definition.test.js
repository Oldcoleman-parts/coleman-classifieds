import { beforeEach, describe, expect, it } from "vitest";
import { recomputeLiveCount } from "@/modules/publishing/index.js";
import { PUBLIC_KEYS } from "@/modules/publishing/services/fields.js";
import { publishingAdmin, publishingWorld } from "./helpers.js";

const NONE = { metaobjectDefinitionByType: null };

describe("Metaobject definition bootstrap (F06-T2)", () => {
  beforeEach(async () => {
    await publishingWorld();
  });

  it("AC: the classified_listing definition is created when missing, publishable, at /pages/classified-listing, public", async () => {
    const shopify = publishingAdmin({ ListingDefinition: NONE });
    await recomputeLiveCount({ admin: shopify.admin });
    const [{ definition }] = shopify.of("ListingDefinitionCreate");
    expect(definition).toMatchObject({
      type: "classified_listing",
      access: { storefront: "PUBLIC_READ" },
      capabilities: {
        publishable: { enabled: true },
        onlineStore: { enabled: true, data: { urlHandle: "classified-listing" } },
      },
    });
    expect(definition.fieldDefinitions.map((field) => field.key)).toEqual(PUBLIC_KEYS);
  });

  it("AC: fields missing from an existing definition are added, and nothing is removed", async () => {
    const have = PUBLIC_KEYS.filter((key) => !["photos", "listing_ref"].includes(key));
    const shopify = publishingAdmin({
      ListingDefinition: {
        metaobjectDefinitionByType: {
          id: "gid://shopify/MetaobjectDefinition/1",
          fieldDefinitions: have.map((key) => ({ key })),
        },
      },
    });
    await recomputeLiveCount({ admin: shopify.admin });
    const [{ id, definition }] = shopify.of("ListingDefinitionUpdate");
    expect(id).toBe("gid://shopify/MetaobjectDefinition/1");
    expect(definition.fieldDefinitions.map((field) => field.create.key)).toEqual([
      "photos",
      "listing_ref",
    ]);
    expect(shopify.of("ListingDefinitionCreate")).toEqual([]);
  });

  it("AC: a definition created by another request a moment ago (TAKEN) is tolerated", async () => {
    const shopify = publishingAdmin({
      ListingDefinition: NONE,
      ListingDefinitionCreate: {
        metaobjectDefinitionCreate: {
          metaobjectDefinition: null,
          userErrors: [{ code: "TAKEN", message: "taken" }],
        },
      },
    });
    await expect(recomputeLiveCount({ admin: shopify.admin })).resolves.toBe(0);
  });
});
