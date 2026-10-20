import { describe, it, expect, beforeEach } from "vitest";
import {
  decryptSecret,
  encryptSecret,
} from "@/modules/payments/services/crypto.js";
import {
  ensureFeeSetup,
  resetFeeSetupCache,
  warmUpFeeSetup,
} from "@/modules/payments/services/setup.js";
import {
  fakeAdmin,
  freshWorld,
  prisma,
  PRODUCT,
  SF_TOKEN,
  VARIANT,
} from "./helpers.js";

describe("Fee setup (F06-T1)", () => {
  beforeEach(freshWorld);

  it("AC: bootstrap creates a hidden, non-shipping fee product once", async () => {
    const shopify = fakeAdmin();
    const setup = await ensureFeeSetup({ admin: shopify.admin });

    expect(setup).toEqual({
      feeProductGid: PRODUCT,
      feeVariantGid: VARIANT,
      storefrontToken: SF_TOKEN,
    });
    expect(shopify.of("FeeProductCreate")[0].product).toMatchObject({
      handle: "coleman-classifieds-listing-fee",
      status: "UNLISTED",
    });
    const [update] = shopify.of("FeeVariantUpdate");
    expect(update.productId).toBe(PRODUCT);
    expect(update.variants[0]).toMatchObject({
      id: VARIANT,
      price: "30.00",
      taxable: false,
      inventoryItem: {
        sku: "CLASSIFIEDS-FEE",
        tracked: false,
        requiresShipping: false,
      },
    });

    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    expect(settings.feeProductGid).toBe(PRODUCT);
    expect(settings.feeVariantGid).toBe(VARIANT);
    const audit = await prisma.auditEvent.findFirst({
      where: { action: "FeeSetupCompleted" },
    });
    expect(JSON.stringify(audit.details)).not.toContain(SF_TOKEN);

    // A second run, even in a new process, asks Shopify for nothing.
    resetFeeSetupCache();
    const before = shopify.calls.length;
    await ensureFeeSetup({ admin: shopify.admin });
    expect(shopify.calls.length).toBe(before);
  });

  it("SEC: the storefront token is stored encrypted", async () => {
    const shopify = fakeAdmin();
    await ensureFeeSetup({ admin: shopify.admin });
    const { storefrontTokenEnc } = await prisma.settings.findUnique({
      where: { id: 1 },
    });
    expect(storefrontTokenEnc).not.toContain(SF_TOKEN);
    expect(decryptSecret(storefrontTokenEnc)).toBe(SF_TOKEN);
    // Two encryptions differ (random IV); a damaged value reads as missing.
    expect(encryptSecret("a")).not.toBe(encryptSecret("a"));
    expect(decryptSecret(`${storefrontTokenEnc}x`)).toBeNull();
    expect(decryptSecret("garbage")).toBeNull();
    expect(decryptSecret(null)).toBeNull();
  });

  it("an existing product with the handle is adopted, not duplicated", async () => {
    const shopify = fakeAdmin({
      FeeProductByHandle: {
        productByIdentifier: {
          id: PRODUCT,
          variants: { nodes: [{ id: VARIANT }] },
        },
      },
    });
    await ensureFeeSetup({ admin: shopify.admin });
    expect(shopify.of("FeeProductCreate")).toHaveLength(0);
    expect(shopify.of("FeeVariantUpdate")).toHaveLength(1);
  });

  it("a userErrors answer rejects and saves nothing; the warm-up doesn't throw", async () => {
    const shopify = fakeAdmin({
      FeeProductCreate: {
        productCreate: {
          product: null,
          userErrors: [{ field: ["handle"], message: "taken" }],
        },
      },
    });
    await expect(ensureFeeSetup({ admin: shopify.admin })).rejects.toThrow(
      /Shopify rejected FeeProductCreate/,
    );
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    expect(settings.feeProductGid).toBeNull();
    expect(settings.storefrontTokenEnc).toBeNull();

    resetFeeSetupCache();
    expect(await warmUpFeeSetup({ admin: shopify.admin, now: 1e12 })).toBe(
      false,
    );
    // After a failure it waits five minutes before asking Shopify again.
    const before = shopify.calls.length;
    expect(
      await warmUpFeeSetup({ admin: shopify.admin, now: 1e12 + 1000 }),
    ).toBe(false);
    expect(shopify.calls.length).toBe(before);
  });

  it("a product with two variants is refused", async () => {
    const shopify = fakeAdmin({
      FeeProductByHandle: {
        productByIdentifier: {
          id: PRODUCT,
          variants: { nodes: [{ id: VARIANT }, { id: "other" }] },
        },
      },
    });
    await expect(ensureFeeSetup({ admin: shopify.admin })).rejects.toThrow(
      /exactly one variant/,
    );
  });

  it("AC: a fresh fee setup publishes the product to Online Store and leaves it UNLISTED", async () => {
    const shopify = fakeAdmin();
    await ensureFeeSetup({ admin: shopify.admin });
    expect(shopify.of("FeeProductCreate")[0].product.status).toBe("UNLISTED");
    expect(shopify.of("FeePublish")).toEqual([
      {
        id: PRODUCT,
        input: [{ publicationId: "gid://shopify/Publication/1" }],
      },
    ]);

    // A second run, in a new process, publishes nothing more.
    resetFeeSetupCache();
    await ensureFeeSetup({ admin: shopify.admin });
    expect(shopify.of("FeePublish")).toHaveLength(1);
  });

  it("finds Online Store by the 2026-10 catalog title", async () => {
    const shopify = fakeAdmin({
      FeePublications: {
        publications: {
          nodes: [
            {
              id: "gid://shopify/Publication/2",
              catalog: { title: "Channel Catalog 2 for Shop" },
            },
            {
              id: "gid://shopify/Publication/3",
              catalog: { title: "Channel Catalog 3 for Online Store" },
            },
          ],
        },
      },
    });
    await ensureFeeSetup({ admin: shopify.admin });
    expect(shopify.of("FeePublish")[0].input).toEqual([
      { publicationId: "gid://shopify/Publication/3" },
    ]);
  });

  it("AC: a store without an Online Store channel fails with FEE_CHANNEL and saves nothing", async () => {
    const shopify = fakeAdmin({
      FeePublications: {
        publications: {
          nodes: [
            { id: "gid://shopify/Publication/2", catalog: { title: "Shop" } },
          ],
        },
      },
    });
    await expect(
      ensureFeeSetup({ admin: shopify.admin }),
    ).rejects.toMatchObject({ code: "FEE_CHANNEL" });
    expect(shopify.of("FeePublish")).toHaveLength(0);
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    expect(settings.feeProductGid).toBeNull();
  });
});
