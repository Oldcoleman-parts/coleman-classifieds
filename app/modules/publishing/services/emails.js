// The seller emails that carry the listing's address: `listing_live` and `revision_approved`.
import { getLinkUrl } from "@/modules/access/index.js";
import { send } from "@/modules/notifications/index.js";
import { HOUR_MS } from "./constants.js";
import { loadListing } from "./facts.js";
import { formatDay, listingUrl, offlineAdmin, shopDomain } from "./shop.js";

/** @typedef {import("@/modules/platform/services/graphql.js").GraphqlClient} GraphqlClient */

const MAX_TRIES = 3;

/** @param {string} name */
const firstName = (name) =>
  String(name ?? "")
    .trim()
    .split(/\s+/)[0] ?? "";

/**
 * Send `listing_live`, at most three times, an hour apart.
 * DECISION (F06-T2): the template is `sensitive`, so a failed send is never queued; the
 * pattern is the one payments uses for `approved_pay`. Try `k` is made only once `k` hours
 * have passed since `liveAt`, and a used key sends nothing, so the hourly task can call this
 * again freely. The key carries `liveAt`, so a later go-live is its own email. The email
 * points to Get my link: only the hash of the seller's private link is stored.
 * @param {string} listingId
 * @param {{ admin?: GraphqlClient, now?: Date }} [options]
 * @returns {Promise<"SENT" | "PENDING" | "FAILED" | "SKIPPED">}
 */
export async function sendLiveEmail(
  listingId,
  { admin, now = new Date() } = {},
) {
  const listing = await loadListing(listingId);
  if (
    listing?.status !== "LIVE" ||
    !listing.liveAt ||
    !listing.expiresAt ||
    !listing.metaobjectHandle
  )
    return "SKIPPED";
  const client = admin ?? (await offlineAdmin());
  const vars = {
    seller_first_name: firstName(listing.invitation.sellerName),
    listing_title: listing.title ?? "",
    expires_date: formatDay(listing.expiresAt),
    listing_url: await listingUrl(client, listing.metaobjectHandle),
    get_link_url: await getLinkUrl(client, shopDomain()),
  };
  const hours = Math.floor(
    (now.getTime() - listing.liveAt.getTime()) / HOUR_MS,
  );
  const tries = Math.min(MAX_TRIES, Math.max(1, hours + 1));
  let status = "FAILED";
  for (let k = 0; k < tries && status === "FAILED"; k++) {
    ({ status } = await send(
      "listing_live",
      listing.invitation.sellerEmail,
      vars,
      {
        idempotencyKey: `listing_live:${listing.id}:${listing.liveAt.getTime()}:${k}`,
        now,
      },
    ));
  }
  return /** @type {any} */ (status);
}

/**
 * Send `revision_approved` once per revision. It isn't sensitive, so notifications queues
 * and retries it itself.
 * @param {string} listingId
 * @param {string} revisionId
 * @param {{ admin?: GraphqlClient }} [options]
 */
export async function sendRevisionEmail(listingId, revisionId, { admin } = {}) {
  const listing = await loadListing(listingId);
  if (!listing?.metaobjectHandle || typeof revisionId !== "string") return;
  const client = admin ?? (await offlineAdmin());
  await send(
    "revision_approved",
    listing.invitation.sellerEmail,
    {
      seller_first_name: firstName(listing.invitation.sellerName),
      listing_title: listing.title ?? "",
      listing_url: await listingUrl(client, listing.metaobjectHandle),
    },
    { idempotencyKey: `revision_approved:${revisionId}` },
  );
}
