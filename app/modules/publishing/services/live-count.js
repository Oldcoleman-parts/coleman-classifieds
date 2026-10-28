// The `classifieds.live_count` shop metafield the header button reads, and the count of
// entries the storefront really shows (for the Health screen).
import { writeAudit } from "@/modules/core/index.js";
import { adminGraphql } from "@/modules/platform/index.js";
import { COUNT_KEY, COUNT_NAMESPACE, LISTING_TYPE } from "./constants.js";
import { ensureDefinitions } from "./definition.js";
import { countLive } from "./facts.js";
import {
  LISTING_ENTRIES,
  LIVE_COUNT_SET,
  SHOP_LIVE_COUNT,
} from "./graphql/admin.js";
import { offlineAdmin } from "./shop.js";

/** @typedef {import("@/modules/platform/services/graphql.js").GraphqlClient} GraphqlClient */

/**
 * The shop's id and currency (for money fields), and the count it shows now.
 * @param {GraphqlClient} admin
 * @returns {Promise<{ id: string, currency: string, count: number | null }>}
 */
export async function shopFacts(admin) {
  const data = await adminGraphql(admin, SHOP_LIVE_COUNT, {
    namespace: COUNT_NAMESPACE,
    key: COUNT_KEY,
  });
  const value = data?.shop?.metafield?.value;
  return {
    id: data?.shop?.id,
    currency: data?.shop?.currencyCode ?? "USD",
    count: value === undefined || value === null ? null : Number(value),
  };
}

/**
 * Set `live_count` to the number of LIVE listings in the app's database. Only the app
 * writes it; it is never taken from Shopify.
 * @param {{ admin?: GraphqlClient }} [context]
 * @returns {Promise<number>} the count
 */
export async function recomputeLiveCount({ admin } = {}) {
  const client = admin ?? (await offlineAdmin());
  await ensureDefinitions({ admin: client });
  const count = await countLive();
  const shop = await shopFacts(client);
  if (shop.count === count) return count;
  await adminGraphql(client, LIVE_COUNT_SET, {
    metafields: [
      {
        ownerId: shop.id,
        namespace: COUNT_NAMESPACE,
        key: COUNT_KEY,
        type: "number_integer",
        value: String(count),
      },
    ],
  });
  await writeAudit({
    action: "LiveCountChanged",
    details: { from: shop.count, to: count },
  });
  return count;
}

/**
 * How many listings the storefront shows as live: published entries whose status is live.
 * @param {{ admin?: GraphqlClient }} [context]
 * @returns {Promise<number | null>} null when Shopify can't be asked
 */
export async function getStorefrontCount({ admin } = {}) {
  try {
    const client = admin ?? (await offlineAdmin());
    let count = 0;
    let after = null;
    for (let page = 0; page < 40; page++) {
      const data = await adminGraphql(client, LISTING_ENTRIES, {
        type: LISTING_TYPE,
        after,
      });
      const { nodes = [], pageInfo } = data?.metaobjects ?? {};
      count += nodes.filter(
        (node) =>
          node?.capabilities?.publishable?.status === "ACTIVE" &&
          node?.field?.value === "live",
      ).length;
      if (!pageInfo?.hasNextPage) return count;
      after = pageInfo.endCursor;
    }
    return count;
  } catch (error) {
    console.error(
      `[publishing] storefront count failed: ${error?.code ?? error?.name ?? "Error"}`,
    );
    return null;
  }
}
