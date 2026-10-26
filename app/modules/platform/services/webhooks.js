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

/**
 * The error's class and code, e.g. "PrismaClientKnownRequestError P1001". Never its message:
 * messages can carry query arguments or personal data.
 * @param {unknown} error
 * @returns {string}
 */
function errorTag(error) {
  if (!error) return "";
  if (error instanceof Response) return `Response ${error.status}`;
  const name = error.constructor?.name || error.name || "Error";
  const code =
    typeof error.code === "string" || typeof error.code === "number"
      ? String(error.code)
          .replace(/[^\w.-]/g, "")
          .slice(0, 32)
      : "";
  return code ? `${name} ${code}` : name;
}

// F01-FIX-8: exactly one line for every answer that isn't a 200. The topic, the ID and the
// step, plus the error's class and code: never the payload, a header or a message.
const logFailure = (topic, webhookId, step, ...errors) => {
  const tags = errors.map(errorTag).filter(Boolean).join("; ");
  console.error(
    `[webhooks] ${topic} ${webhookId || "-"} ${step}${tags ? `: ${tags}` : ""}`,
  );
};

// DECISION (F01-FIX-8): before the signature is checked, the topic header is logged only in
// its normalised form (letters, digits and _), and the webhook ID header is not logged.
const unverifiedTopic = (request) =>
  normalise(request.headers.get("x-shopify-topic") ?? "unknown").slice(0, 64);

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
 * @returns {Promise<Response>} 401 for a missing or bad signature, 405 for a wrong method;
 *   200 once the handler has succeeded (now or on an earlier delivery); 500 when the handler
 *   failed, when another request is still working on this delivery, when the receipt could
 *   not be claimed or saved, or when the signature check itself failed, so Shopify retries.
 *   Every answer but 200 writes one log line.
 */
export async function handleWebhook(request) {
  let context;
  try {
    // Verifies the HMAC (constant-time) against the raw body before anything is parsed.
    context = await authenticate.webhook(request);
  } catch (error) {
    if (!(error instanceof Response)) {
      // DECISION (F01-FIX-8): an unexpected error answers 500 so Shopify retries. A signature
      // that doesn't match is never a 500.
      logFailure(unverifiedTopic(request), null, "authenticate", error);
      return answer(500);
    }
    const method = error.status === 405;
    logFailure(
      unverifiedTopic(request),
      null,
      method ? "method" : "signature",
      error,
    );
    // The library answers 400 when the signature header is missing; treat that as unsigned.
    return answer(method ? 405 : 401);
  }
  const { shop, payload, webhookId, admin } = context;
  const topic = normalise(context.topic);

  // The receipt goes in first. Only a processed one stops a repeat delivery with a 200.
  const claimedAt = new Date();
  let state;
  try {
    state = await claim(webhookId, topic, claimedAt);
  } catch (error) {
    // No receipt was written, so the retry starts afresh.
    logFailure(topic, webhookId, "claim", error);
    return answer(500);
  }
  if (state === "processed") return answer(200);
  // DECISION (F01-FIX-2): another request claimed this delivery less than a minute ago.
  // Answer 500 so Shopify tries again later, when it is either processed or stale.
  if (state === "busy") {
    logFailure(topic, webhookId, "busy");
    return answer(500);
  }

  try {
    // A topic nobody handles has nothing to do, and is processed.
    await handlers.get(topic)?.({ shop, topic, webhookId, payload, admin });
  } catch (error) {
    // DECISION (F01-FIX-2): drop our own claim so the retry runs at once. If that fails, the
    // receipt stays unprocessed and is taken over after the claim window.
    try {
      await prisma.webhookReceipt.deleteMany({
        where: { id: webhookId, processedAt: null, receivedAt: claimedAt },
      });
      logFailure(topic, webhookId, "handler", error);
    } catch (deleteError) {
      logFailure(topic, webhookId, "handler, claim kept", error, deleteError);
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
    logFailure(topic, webhookId, "receipt", error);
    return answer(500);
  }
  return answer(200);
}
