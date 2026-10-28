// Writing a listing's storefront page so it matches the app: open listings show their
// details, paused ones are hidden, closed ones show only "no longer available".
// Every function here is safe to repeat; the app's database is always the source.
import { writeAudit } from "@/modules/core/index.js";
import { getPublicUrls, publish } from "@/modules/media/index.js";
import { adminGraphql } from "@/modules/platform/index.js";
import { LISTING_TYPE } from "./constants.js";
import { ensureDefinitions } from "./definition.js";
import { CLOSED_STATUSES, loadListing, saveEntry } from "./facts.js";
import { buildFields, closedFields, makeHandle } from "./fields.js";
import { LISTING_UPSERT } from "./graphql/admin.js";
import { recomputeLiveCount, shopFacts } from "./live-count.js";
import { offlineAdmin } from "./shop.js";

/**
 * @typedef {import("./facts.js").Publishable} Publishable
 * @typedef {import("@/modules/platform/services/graphql.js").GraphqlClient} GraphqlClient
 * @typedef {"PUBLISHED" | "HIDDEN" | "CLOSED" | "SKIPPED"} SyncResult
 */

/**
 * What the page should be for the listing's status, or null when it has none.
 * DECISION (F06-T2): a closed page stays ACTIVE (showing "no longer available") until
 * retention deletes it and redirects its address (operations.md); PAYMENT_OVERDUE (Phase 2)
 * is hidden like a pause.
 * @param {Publishable} listing
 * @returns {"OPEN" | "HIDDEN" | "CLOSED" | null}
 */
function pageFor(listing) {
  if (listing.status === "LIVE") return "OPEN";
  if (listing.status === "PAUSED" || listing.status === "PAYMENT_OVERDUE")
    return "HIDDEN";
  // A listing that never had a page (rejected, lapsed, closed before payment) gets none.
  if (CLOSED_STATUSES.includes(listing.status) && listing.liveAt)
    return "CLOSED";
  return null;
}

/**
 * Write one listing's page.
 * @param {string} listingId
 * @param {{ admin?: GraphqlClient, count?: boolean }} [options] `count: false` leaves
 *   `live_count` alone (the hourly task sets it once at the end)
 * @returns {Promise<SyncResult>}
 */
export async function syncListing(listingId, { admin, count = true } = {}) {
  const listing = await loadListing(listingId);
  if (!listing) return "SKIPPED";
  const page = pageFor(listing);
  if (!page) return "SKIPPED";
  // A closed listing that never got a page has nothing to close.
  if (page === "CLOSED" && !listing.metaobjectGid) return "SKIPPED";

  const client = admin ?? (await offlineAdmin());
  await ensureDefinitions({ admin: client });

  let fields;
  if (page === "CLOSED") fields = closedFields(listing);
  else {
    // Photos are made public before the page points at them (F03-T2 note). A paused listing
    // keeps the photos it already has.
    const photos =
      page === "OPEN"
        ? await publish(listing.id)
        : await getPublicUrls(listing.id);
    const { currency } = await shopFacts(client);
    fields = buildFields(listing, photos, { currency });
  }

  const handle = listing.metaobjectHandle ?? makeHandle(listing);
  const data = await adminGraphql(client, LISTING_UPSERT, {
    handle: { type: LISTING_TYPE, handle },
    metaobject: {
      fields,
      capabilities: {
        publishable: { status: page === "HIDDEN" ? "DRAFT" : "ACTIVE" },
      },
    },
  });
  const entry = data?.metaobjectUpsert?.metaobject;
  await saveEntry(listing, {
    gid: entry?.id ?? listing.metaobjectGid,
    handle: entry?.handle ?? handle,
  });

  if (count) await recomputeLiveCount({ admin: client });
  return page === "OPEN"
    ? "PUBLISHED"
    : page === "HIDDEN"
      ? "HIDDEN"
      : "CLOSED";
}

/**
 * Write the page and record what the storefront now shows.
 * @param {string} listingId
 * @param {string} reason the event that asked for it, e.g. "ListingPaused"
 * @param {{ admin?: GraphqlClient }} [options]
 * @returns {Promise<SyncResult>}
 */
export async function syncAndAudit(listingId, reason, { admin } = {}) {
  const result = await syncListing(listingId, { admin });
  // Routine field updates aren't audited; the page appearing, hiding or closing is.
  const action = {
    ListingWentLive: "ListingPublished",
    ListingPaused: "ListingUnpublished",
    ListingResumed: "ListingRepublished",
    ListingClosed: "ListingPageClosed",
  }[reason];
  if (action && result !== "SKIPPED")
    await writeAudit({ action, listingId, details: { result } });
  return result;
}
