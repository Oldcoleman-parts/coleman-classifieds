// Find paid fee orders whose `orders/paid` never reached us (F06-FIX-3), and record them the
// way the webhook would have. Every order goes through the same checks (`recordPaidOrder()`),
// so the reconcile can never publish what the webhook would have refused.
import prisma from "@/db.server";
import { getSettings, writeAudit } from "@/modules/core/index.js";
import { adminGraphql } from "@/modules/platform/index.js";
import { applyCharge } from "./apply.js";
import { DAY_MS, FEE_SKU } from "./constants.js";
import { FEE_ORDERS_PAID } from "./graphql/admin.js";
import { readAdminOrder } from "./order-payload.js";
import { recordPaidOrder } from "./orders-paid.js";

/**
 * @typedef {import("./order-payload.js").FeeOrderFacts} FeeOrderFacts
 * @typedef {import("@/modules/platform/services/graphql.js").GraphqlClient} GraphqlClient
 */

// DECISION (F06-FIX-3): 4 pages of 50 a run. Fee orders are rare; hitting the cap is logged.
const MAX_PAGES = 4;

/**
 * How far back to look: the payment window plus 3 days, and never past the 60 days that
 * `read_orders` can see.
 * @param {Date} now
 * @returns {Promise<Date>}
 */
export async function reconcileWindowStart(now) {
  const { paymentWindowDays } = await getSettings();
  const days = Math.min(paymentWindowDays + 3, 59);
  return new Date(now.getTime() - days * DAY_MS);
}

/**
 * Paid fee orders created since `since`, newest first.
 * @param {{ admin: GraphqlClient, since: Date, listingIds?: string[] }} options
 * @returns {Promise<FeeOrderFacts[]>}
 * @throws when Shopify can't be reached or refuses: the caller decides what that means
 */
export async function findPaidFeeOrders({ admin, since, listingIds }) {
  const query = `sku:'${FEE_SKU}' financial_status:paid created_at:>='${since.toISOString()}'`;
  /** @type {FeeOrderFacts[]} */
  const found = [];
  let after = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await adminGraphql(admin, FEE_ORDERS_PAID, { query, after });
    for (const node of data?.orders?.nodes ?? []) {
      const order = readAdminOrder(node);
      // The search only narrows; `recordPaidOrder()` decides, as for the webhook.
      if (!order) continue;
      if (listingIds && !listingIds.includes(order.listingId ?? "")) continue;
      found.push(order);
    }
    const info = data?.orders?.pageInfo;
    if (!info?.hasNextPage) return found;
    after = info.endCursor;
  }
  console.error(`[payments] reconcile stopped after ${MAX_PAGES} pages`);
  return found;
}

/**
 * Record and apply every paid fee order in the window that has no charge yet.
 * The apply is awaited, so a lapse run that follows sees the listing live.
 * @param {{ admin: GraphqlClient, now?: Date, listingIds?: string[] }} options
 * @returns {Promise<{ checked: number, recorded: number, mismatched: number, applied: number }>}
 * @throws when Shopify can't be reached
 */
export async function reconcilePaidOrders({
  admin,
  now = new Date(),
  listingIds,
}) {
  const orders = await findPaidFeeOrders({
    admin,
    since: await reconcileWindowStart(now),
    listingIds,
  });
  const summary = {
    checked: orders.length,
    recorded: 0,
    mismatched: 0,
    applied: 0,
  };
  if (orders.length === 0) return summary;
  const known = new Set(
    (
      await prisma.feeCharge.findMany({
        where: { orderGid: { in: orders.map((order) => order.orderGid) } },
        select: { orderGid: true },
      })
    ).map((charge) => charge.orderGid),
  );
  for (const order of orders) {
    if (known.has(order.orderGid)) continue;
    const recorded = await recordPaidOrder(order);
    if (!recorded) continue;
    if ("mismatch" in recorded) {
      summary.mismatched += 1;
      continue;
    }
    summary.recorded += 1;
    await writeAudit({
      action: "FeeOrderReconciled",
      details: { orderGid: order.orderGid, chargeId: recorded.chargeId },
    });
    if ((await applyCharge(recorded.chargeId, { now })) === "APPLIED")
      summary.applied += 1;
  }
  return summary;
}

/**
 * The paid fee order for one listing, if Shopify has one (the pay page's check).
 * @param {{ id: string }} payable
 * @param {{ admin: GraphqlClient, now?: Date }} context
 * @returns {Promise<FeeOrderFacts | null>}
 * @throws when Shopify can't be reached
 */
export async function findPaidOrderFor(payable, { admin, now = new Date() }) {
  const [order] = await findPaidFeeOrders({
    admin,
    since: await reconcileWindowStart(now),
    listingIds: [payable.id],
  });
  return order ?? null;
}

/**
 * @param {string} listingId
 * @returns {Promise<{ id: string, appliedAt: Date | null } | null>} the listing's recorded
 *   fee payment, if any
 */
export function findPaidCharge(listingId) {
  return prisma.feeCharge.findFirst({
    where: { listingId, kind: "INITIAL", status: "PAID" },
    select: { id: true, appliedAt: true },
    orderBy: { createdAt: "asc" },
  });
}
