// The one-time Shopify setup for fee payments: the hidden fee product and the storefront
// token. Safe to call before every use: once done it costs one settings read.
import prisma from "@/db.server";
import { AppError, getSettings, writeAudit } from "@/modules/core/index.js";
import { adminGraphql } from "@/modules/platform/index.js";
import { FEE_HANDLE, FEE_SKU } from "./constants.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import {
  FEE_PRODUCT_BY_HANDLE,
  FEE_PRODUCT_CREATE,
  FEE_VARIANT_UPDATE,
  STOREFRONT_TOKEN_CREATE,
} from "./graphql/admin.js";

/**
 * @typedef {{ feeProductGid: string, feeVariantGid: string, storefrontToken: string }} FeeSetup
 * @typedef {import("@/modules/platform/services/graphql.js").GraphqlClient} GraphqlClient
 */

// Any fixed number: one setup at a time across every process that shares the database.
const SETUP_LOCK = 606001;

/** @type {FeeSetup | null} */
let cached = null;

/**
 * @param {{ feeProductGid: string | null, feeVariantGid: string | null, storefrontTokenEnc: string | null }} settings
 * @returns {FeeSetup | null} null while a step is missing
 */
function complete(settings) {
  const storefrontToken = decryptSecret(settings.storefrontTokenEnc);
  if (!settings.feeProductGid || !settings.feeVariantGid || !storefrontToken)
    return null;
  return {
    feeProductGid: settings.feeProductGid,
    feeVariantGid: settings.feeVariantGid,
    storefrontToken,
  };
}

/**
 * Find the fee product by its handle, or create it, and give its one variant the fee
 * settings. An existing product is adopted, never duplicated.
 * @param {GraphqlClient} admin
 * @param {number} baseFeeCents
 * @returns {Promise<{ feeProductGid: string, feeVariantGid: string }>}
 */
async function ensureProduct(admin, baseFeeCents) {
  const found = await adminGraphql(admin, FEE_PRODUCT_BY_HANDLE, {
    handle: FEE_HANDLE,
  });
  const product =
    found?.productByIdentifier ??
    (
      await adminGraphql(admin, FEE_PRODUCT_CREATE, {
        product: {
          title: "Classifieds listing fee (one month)",
          handle: FEE_HANDLE,
          status: "UNLISTED",
          productType: "Listing fee",
        },
      })
    )?.productCreate?.product;
  const variants = product?.variants?.nodes ?? [];
  // More than one variant means someone edited the product: staff must fix it by hand.
  if (!product?.id || variants.length !== 1)
    throw new AppError("The fee product must have exactly one variant", {
      code: "FEE_PRODUCT",
    });
  await adminGraphql(admin, FEE_VARIANT_UPDATE, {
    productId: product.id,
    variants: [
      {
        id: variants[0].id,
        price: (baseFeeCents / 100).toFixed(2),
        // DECISION (F06-T1): the listing fee is not taxed; OCP's accountant should confirm.
        taxable: false,
        inventoryPolicy: "CONTINUE",
        inventoryItem: {
          sku: FEE_SKU,
          tracked: false,
          requiresShipping: false,
        },
      },
    ],
  });
  return { feeProductGid: product.id, feeVariantGid: variants[0].id };
}

/**
 * Make sure the fee product and the storefront token exist, and return them.
 * DECISION (F06-T1): it runs when first needed (the first approval or checkout), not at
 * install. Each step saves its result as soon as it succeeds, so a failed run resumes.
 * DECISION (F06-T1): the selling plan group is left to F09: it needs the
 * `write_purchase_options` scope, which `shopify-config.md` assigns to that feature.
 * @param {{ admin: GraphqlClient }} context
 * @returns {Promise<FeeSetup>}
 * @throws {import("@/modules/core/index.js").ShopifyUserError} when Shopify refuses a step
 */
export async function ensureFeeSetup({ admin }) {
  if (cached) return cached;
  const ready = complete(await getSettings());
  if (ready) return (cached = ready);

  const created = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETUP_LOCK})`;
      // Read again inside the lock: another request may have finished the setup.
      const settings = await getSettings({ tx });
      const done = [];
      let { feeProductGid, feeVariantGid, storefrontTokenEnc } = settings;
      if (!feeProductGid || !feeVariantGid) {
        ({ feeProductGid, feeVariantGid } = await ensureProduct(
          admin,
          settings.baseFeeCents,
        ));
        done.push("product");
      }
      if (!decryptSecret(storefrontTokenEnc)) {
        const data = await adminGraphql(admin, STOREFRONT_TOKEN_CREATE, {
          input: { title: "Coleman Classifieds checkout" },
        });
        const token =
          data?.storefrontAccessTokenCreate?.storefrontAccessToken?.accessToken;
        if (typeof token !== "string" || token === "")
          throw new AppError("Shopify returned no storefront token", {
            code: "FEE_SETUP",
          });
        storefrontTokenEnc = encryptSecret(token);
        done.push("storefrontToken");
      }
      if (done.length === 0) return settings;
      const saved = await tx.settings.update({
        where: { id: 1 },
        data: { feeProductGid, feeVariantGid, storefrontTokenEnc },
      });
      // The ids only: the token is never written to the history or a log.
      await writeAudit(
        {
          action: "FeeSetupCompleted",
          details: { feeProductGid, feeVariantGid, steps: done },
        },
        { tx },
      );
      console.log(`[payments] fee setup done: ${done.join(", ")}`);
      return saved;
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
  cached = complete(created);
  if (!cached)
    throw new AppError("The fee setup is not complete", { code: "FEE_SETUP" });
  return cached;
}

const RETRY_AFTER_MS = 5 * 60 * 1000;
let lastFailure = 0;

/**
 * Run the setup when staff open the app, so the fee product exists before the first
 * approval. It never throws: a failure is logged (error type only) and tried again after
 * five minutes, and the first approval or checkout runs the setup anyway.
 * @param {{ admin: GraphqlClient, now?: number }} context
 * @returns {Promise<boolean>} true when the setup is complete
 */
export async function warmUpFeeSetup({ admin, now = Date.now() }) {
  if (cached) return true;
  if (now - lastFailure < RETRY_AFTER_MS) return false;
  try {
    await ensureFeeSetup({ admin });
    return true;
  } catch (error) {
    lastFailure = now;
    console.error(
      `[payments] fee setup failed: ${error?.code ?? error?.name ?? "Error"}`,
    );
    return false;
  }
}

/** Forget the cached setup (tests, and after the settings row changed). */
export function resetFeeSetupCache() {
  cached = null;
  lastFailure = 0;
}
