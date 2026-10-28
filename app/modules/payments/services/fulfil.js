// A fee order has nothing to ship: mark it fulfilled at once, without telling the customer,
// so it never waits in a fulfilment queue or triggers a shipping email.
import { AppError } from "@/modules/core/index.js";
import { adminGraphql } from "@/modules/platform/index.js";
import { FULFILMENT_CREATE, ORDER_FULFILMENT_STATE } from "./graphql/admin.js";

const OPEN = ["OPEN", "IN_PROGRESS"];

/**
 * Fulfil what is still open on the order. A second run finds nothing open and does nothing.
 * @param {string} orderGid
 * @param {{ admin: import("@/modules/platform/services/graphql.js").GraphqlClient }} context
 * @returns {Promise<{ fulfilled: number }>} how many fulfilments this run created
 * @throws {AppError} code `NOT_READY` when Shopify has not created the fulfilment order yet
 */
export async function ensureFulfilled(orderGid, { admin }) {
  const data = await adminGraphql(admin, ORDER_FULFILMENT_STATE, {
    id: orderGid,
  });
  const order = data?.order;
  if (!order) throw new AppError("Order not found", { code: "NOT_READY" });
  if (order.displayFulfillmentStatus === "FULFILLED") return { fulfilled: 0 };
  const open = (order.fulfillmentOrders?.nodes ?? []).filter((node) =>
    OPEN.includes(node.status),
  );
  if (open.length === 0)
    throw new AppError("No fulfilment order yet", { code: "NOT_READY" });
  for (const { id } of open)
    await adminGraphql(admin, FULFILMENT_CREATE, {
      fulfillment: {
        lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: id }],
        notifyCustomer: false,
      },
    });
  return { fulfilled: open.length };
}
