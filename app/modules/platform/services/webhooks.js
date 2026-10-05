// The webhook router: verify, de-duplicate, then hand over to the module that owns the topic.
import prisma from "@/db.server";
import { authenticate } from "@/shopify.server";

/**
 * @typedef {object} WebhookContext
 * @property {string} shop
 * @property {string} topic e.g. "ORDERS_PAID"
 * @property {string} webhookId
 * @property {any} payload validate before use
 * @property {import("./graphql.js").GraphqlClient} [admin] absent when the app is uninstalled
 *
 * @typedef {(context: WebhookContext) => unknown | Promise<unknown>} WebhookHandler
 */

/** @type {Map<string, WebhookHandler>} */
const handlers = new Map();

// "orders/paid" and "ORDERS_PAID" are the same topic.
const normalise = (topic) => topic.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

/**
 * Register the handler for a topic. One handler per topic: the owning module's.
 * The handler must be idempotent and should publish events rather than call other modules.
 * @param {string} topic e.g. "orders/paid"
 * @param {WebhookHandler} handler
 */
export function onWebhook(topic, handler) {
  handlers.set(normalise(topic), handler);
}

/** Remove every handler. Called when the platform module registers. */
export function resetWebhookHandlers() {
  handlers.clear();
}

/**
 * Handle one webhook delivery. Use as the whole body of a thin `webhooks.*` route action.
 * @param {Request} request
 * @returns {Promise<Response>} 401 for a missing or bad signature, 200 once handled (or
 *   already handled), 500 when the handler failed so Shopify retries
 */
export async function handleWebhook(request) {
  let context;
  try {
    // Verifies the HMAC (constant-time) against the raw body before anything is parsed.
    context = await authenticate.webhook(request);
  } catch (error) {
    if (!(error instanceof Response)) throw error;
    // The library answers 400 when the signature header is missing; treat that as unsigned.
    return new Response(null, { status: error.status === 405 ? 405 : 401 });
  }
  const { shop, payload, webhookId, admin } = context;
  const topic = normalise(context.topic);

  // The receipt goes in first: a second delivery of the same webhook stops here.
  try {
    await prisma.webhookReceipt.create({ data: { id: webhookId, topic } });
  } catch (error) {
    if (error?.code === "P2002") return new Response(null, { status: 200 });
    throw error;
  }

  const handler = handlers.get(topic);
  if (!handler) return new Response(null, { status: 200 });

  try {
    await handler({ shop, topic, webhookId, payload, admin });
  } catch (error) {
    // Forget the receipt so Shopify's retry is processed. The ID and error type only.
    await prisma.webhookReceipt.delete({ where: { id: webhookId } });
    console.error(
      `[webhooks] ${topic} ${webhookId} failed: ${error?.name}${error?.code ? ` ${error.code}` : ""}`,
    );
    return new Response(null, { status: 500 });
  }
  return new Response(null, { status: 200 });
}
