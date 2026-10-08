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

// DECISION (F01-FIX-2): a delivery that has not finished after a minute is taken to be dead,
// and the next delivery runs the handler again. Handlers must finish well inside this.
const CLAIM_WINDOW_MS = 60_000;

// "orders/paid" and "ORDERS_PAID" are the same topic.
const normalise = (topic) => topic.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

/**
 * Register the handler for a topic. One handler per topic: the owning module's.
 * The handler must be idempotent (it runs again when a delivery died half-way) and should
 * publish events rather than call other modules.
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

const answer = (status) => new Response(null, { status });

// The ID and error type only: never the payload.
const logFailure = (topic, webhookId, step, error) =>
  console.error(
    `[webhooks] ${topic} ${webhookId} ${step}: ${error?.name}${error?.code ? ` ${error.code}` : ""}`,
  );

/**
 * Claim a delivery: insert its receipt, or take over one whose handler never finished.
 * @param {string} id
 * @param {string} topic
 * @param {Date} now written as `receivedAt`, which marks this request's claim
 * @returns {Promise<"claimed" | "processed" | "busy">}
 */
async function claim(id, topic, now) {
  try {
    await prisma.webhookReceipt.create({
      data: { id, topic, receivedAt: now },
    });
    return "claimed";
  } catch (error) {
    if (error?.code !== "P2002") throw error;
  }
  // One conditional UPDATE: of two retries arriving together, only one matches the row.
  const stale = new Date(now.getTime() - CLAIM_WINDOW_MS);
  const { count } = await prisma.webhookReceipt.updateMany({
    where: { id, processedAt: null, receivedAt: { lt: stale } },
    data: { receivedAt: now },
  });
  if (count === 1) return "claimed";
  const receipt = await prisma.webhookReceipt.findUnique({ where: { id } });
  return receipt?.processedAt ? "processed" : "busy";
}

/**
 * Handle one webhook delivery. Use as the whole body of a thin `webhooks.*` route action.
 * @param {Request} request
 * @returns {Promise<Response>} 401 for a missing or bad signature; 200 once the handler has
 *   succeeded (now or on an earlier delivery); 500 when the handler failed, when another
 *   request is still working on this delivery, or when the receipt could not be saved, so
 *   Shopify retries
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

  // The receipt goes in first. Only a processed one stops a repeat delivery with a 200.
  const claimedAt = new Date();
  const state = await claim(webhookId, topic, claimedAt);
  if (state === "processed") return answer(200);
  // DECISION (F01-FIX-2): another request claimed this delivery less than a minute ago.
  // Answer 500 so Shopify tries again later, when it is either processed or stale.
  if (state === "busy") return answer(500);

  try {
    // A topic nobody handles has nothing to do, and is processed.
    await handlers.get(topic)?.({ shop, topic, webhookId, payload, admin });
  } catch (error) {
    logFailure(topic, webhookId, "failed", error);
    // DECISION (F01-FIX-2): drop our own claim so the retry runs at once. If that fails, the
    // receipt stays unprocessed and is taken over after the claim window.
    try {
      await prisma.webhookReceipt.deleteMany({
        where: { id: webhookId, processedAt: null, receivedAt: claimedAt },
      });
    } catch (deleteError) {
      logFailure(topic, webhookId, "claim not released", deleteError);
    }
    return answer(500);
  }

  try {
    const processedAt = new Date();
    await prisma.webhookReceipt.upsert({
      where: { id: webhookId },
      update: { processedAt },
      create: { id: webhookId, topic, receivedAt: claimedAt, processedAt },
    });
  } catch (error) {
    // DECISION (F01-FIX-2): never 200 without a processed receipt. The handler runs again
    // after the claim window, which is safe because handlers are idempotent.
    logFailure(topic, webhookId, "not marked processed", error);
    return answer(500);
  }
  return answer(200);
}
