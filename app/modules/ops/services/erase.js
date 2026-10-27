// Privacy redact (F08-T5): Shopify's customers/redact and shop/redact, through the hook
// platform calls (`onPrivacyRequest`). Each owner anonymises its own rows via its index.js.
// DECISION: a direct hook, not an event: a failure must throw so the webhook answers 500
// and Shopify retries, while the event bus logs and swallows handler failures.
// DECISION: fixed order, the invitation last: the seller's terms acceptances are found
// through their invitations, so a run that fails part way still finds them on the retry.
// Kept: fee charges, photos (normal retention) and audit rows (until retention).
import {
  eraseAllSellers,
  eraseSeller,
  listingIdsForSellerEmail,
} from "@/modules/access/index.js";
import {
  eraseAllSubscribers,
  eraseSubscriber,
} from "@/modules/alerts/index.js";
import { eraseAllBuyers, eraseBuyer } from "@/modules/contact/index.js";
import {
  requireEmail,
  ValidationError,
  writeAudit,
} from "@/modules/core/index.js";
import {
  eraseAddress,
  eraseAllAddresses,
} from "@/modules/notifications/index.js";
import { eraseTermsNetworkData } from "@/modules/workspace/index.js";

const ACTION = "PrivacyErased";

/**
 * @typedef {{ invitations: number, terms: number, messages: number, subscribers: number,
 *   outbox: number, suppressions: number }} EraseCounts
 */

/**
 * Anonymises one customer's seller, buyer and subscriber rows and their emails. Sellers and
 * buyers are matched by email (trimmed, lower case); the Shopify customer id isn't used.
 * Repeats change nothing.
 * @param {{ email?: unknown, webhookId?: string }} request
 * @returns {Promise<EraseCounts | null>} null when the payload has no valid email
 */
export async function eraseCustomer({ email, webhookId }) {
  let address;
  try {
    address = requireEmail(email, "email");
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    // DECISION: nothing can match, so audit and finish (a retry wouldn't help).
    await writeAudit({
      action: ACTION,
      details: { scope: "customer", webhookId, skipped: "no-email" },
    });
    return null;
  }

  const listingIds = await listingIdsForSellerEmail(address);
  const counts = {
    ...(await eraseTermsNetworkData(listingIds)),
    ...(await eraseBuyer(address)),
    ...(await eraseSubscriber(address)),
    ...(await eraseAddress(address)),
    ...(await eraseSeller(address)),
  };
  return audited("customer", webhookId, counts);
}

/**
 * Anonymises every seller, buyer and subscriber row and every email (48 hours after an
 * uninstall). Repeats change nothing.
 * @param {{ webhookId?: string }} [request]
 * @returns {Promise<EraseCounts>}
 */
export async function eraseShop({ webhookId } = {}) {
  const counts = {
    ...(await eraseTermsNetworkData("all")),
    ...(await eraseAllBuyers()),
    ...(await eraseAllSubscribers()),
    ...(await eraseAllAddresses()),
    ...(await eraseAllSellers()),
  };
  return audited("shop", webhookId, counts);
}

/**
 * The privacy handler ops registers with platform.
 * @param {import("@/modules/platform/services/privacy.js").PrivacyRequest} request
 */
export function handlePrivacyRequest({ kind, email, webhookId }) {
  return kind === "shop"
    ? eraseShop({ webhookId })
    : eraseCustomer({ email, webhookId });
}

// One audit entry per request, counts only (never an email), also when all are zero.
async function audited(scope, webhookId, counts) {
  /** @type {EraseCounts} */
  const result = {
    invitations: counts.invitations,
    terms: counts.terms,
    messages: counts.messages,
    subscribers: counts.subscribers,
    outbox: counts.outbox,
    suppressions: counts.suppressions,
  };
  await writeAudit({
    action: ACTION,
    details: { scope, webhookId, counts: result },
  });
  return result;
}
