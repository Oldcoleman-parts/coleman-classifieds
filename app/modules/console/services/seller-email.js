// The emails staff decisions send to the seller. The decision is already saved when these
// run, so a failed email never undoes it: staff get a problem report instead.
import { shopTimeZone } from "@/modules/core/index.js";
import { reportEmailProblem, send } from "@/modules/notifications/index.js";

/**
 * @param {Date | null} date
 * @returns {string} for example "October 19, 2026", in the shop's time zone
 */
export function formatDay(date) {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: shopTimeZone(),
  }).format(date);
}

/**
 * The placeholders every seller decision email shares.
 * @param {{ title: string | null }} listing
 * @param {{ sellerName: string, itemSummary: string }} invitation
 */
export function sellerVars(listing, invitation) {
  return {
    seller_first_name: invitation.sellerName.trim().split(/\s+/)[0] ?? "",
    listing_title: listing.title ?? invitation.itemSummary,
  };
}

/**
 * The "Get my link" address for the email's help line, or nothing if the storefront address
 * can't be looked up right now.
 * @param {(() => Promise<string>) | undefined} getLinkUrl
 * @returns {Promise<{ get_link_url?: string }>}
 */
export async function linkHelp(getLinkUrl) {
  if (!getLinkUrl) return {};
  try {
    return { get_link_url: await getLinkUrl() };
  } catch (error) {
    console.error(`[console] get-link url lookup failed: ${error?.name}`);
    return {};
  }
}

/**
 * Send one decision email to the seller. Never throws; logs ids only.
 * @param {string} key the template key
 * @param {string} to the seller's email
 * @param {Record<string, string>} vars
 * @param {{ listingId: string, idempotencyKey: string }} options
 * @returns {Promise<string>} the outbox status, or "FAILED"
 */
export async function sendSellerEmail(
  key,
  to,
  vars,
  { listingId, idempotencyKey },
) {
  let status;
  try {
    ({ status } = await send(key, to, vars, { idempotencyKey }));
  } catch (error) {
    console.error(`[console] ${key} email for ${listingId}: ${error?.name}`);
    status = "FAILED";
  }
  if (status === "FAILED")
    await reportEmailProblem(
      `email-failed:${key}:${listingId}`,
      "A decision email to a seller couldn't be sent",
      { template: key, listingId },
    );
  return status;
}
