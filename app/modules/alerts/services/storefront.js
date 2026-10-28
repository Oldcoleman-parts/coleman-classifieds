// The `classifieds.alerts_enabled` shop metafield: the theme shows the signup only while it
// is true, so turning alerts off hides the signup without a theme change.
import { isEnabled } from "@/modules/core/index.js";
import { adminGraphql } from "@/modules/platform/index.js";
import { ALERTS_FLAG_SET, SHOP_ALERTS_FLAG } from "./graphql/admin.js";
import { offlineAdmin } from "./links.js";

/** @typedef {import("@/modules/platform/services/graphql.js").GraphqlClient} GraphqlClient */

export const FLAG_NAMESPACE = "classifieds";
export const FLAG_KEY = "alerts_enabled";

/**
 * Write the alerts switch to the shop metafield, only when it differs.
 * @param {{ admin?: GraphqlClient }} [context]
 * @returns {Promise<boolean>} the value the storefront now has
 * @throws {import("@/modules/core/index.js").ShopifyUserError} when Shopify refuses it
 */
export async function syncSignupVisibility({ admin } = {}) {
  const client = admin ?? (await offlineAdmin());
  const enabled = await isEnabled("alerts");
  const data = await adminGraphql(client, SHOP_ALERTS_FLAG, {
    namespace: FLAG_NAMESPACE,
    key: FLAG_KEY,
  });
  if (data?.shop?.metafield?.value === String(enabled)) return enabled;
  await adminGraphql(client, ALERTS_FLAG_SET, {
    metafields: [
      {
        ownerId: data?.shop?.id,
        namespace: FLAG_NAMESPACE,
        key: FLAG_KEY,
        type: "boolean",
        value: String(enabled),
      },
    ],
  });
  return enabled;
}
