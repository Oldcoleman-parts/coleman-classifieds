// The end of a closed listing's page, when photo retention ends (operations.md): delete the
// entry and send its address to the browse page. F08-T1's retention task calls this.
import { TERMINAL_STATUSES, writeAudit } from "@/modules/core/index.js";
import { adminGraphql } from "@/modules/platform/index.js";
import { BROWSE_PATH, URL_HANDLE } from "./constants.js";
import { loadListing, saveEntry } from "./facts.js";
import {
  LISTING_DELETE,
  REDIRECT_BY_PATH,
  REDIRECT_CREATE,
} from "./graphql/admin.js";
import { offlineAdmin } from "./shop.js";

/** @typedef {import("@/modules/platform/services/graphql.js").GraphqlClient} GraphqlClient */

/**
 * Safe to repeat: a deleted entry and an existing redirect are left as they are.
 * @param {string} listingId a closed listing
 * @param {{ admin?: GraphqlClient }} [options]
 * @returns {Promise<{ deleted: boolean }>} false when there was nothing to delete or the
 *   listing isn't closed
 */
export async function retireListing(listingId, { admin } = {}) {
  const listing = await loadListing(listingId);
  if (!listing || !TERMINAL_STATUSES.includes(listing.status))
    return { deleted: false };
  if (!listing.metaobjectGid && !listing.metaobjectHandle)
    return { deleted: false };
  const client = admin ?? (await offlineAdmin());

  // The redirect first: once the entry is gone, its address would otherwise be a 404.
  if (listing.metaobjectHandle) {
    const path = `/pages/${URL_HANDLE}/${listing.metaobjectHandle}`;
    const found = await adminGraphql(client, REDIRECT_BY_PATH, {
      query: `path:${path}`,
    });
    const exists = (found?.urlRedirects?.nodes ?? []).some(
      (node) => node.path === path,
    );
    if (!exists)
      await adminGraphql(client, REDIRECT_CREATE, {
        urlRedirect: { path, target: BROWSE_PATH },
      });
  }

  let deleted = false;
  if (listing.metaobjectGid) {
    try {
      await adminGraphql(client, LISTING_DELETE, { id: listing.metaobjectGid });
      deleted = true;
    } catch (error) {
      // Already deleted (by hand, or by an earlier run).
      const gone = /** @type {any} */ (error)?.userErrors?.some(
        (problem) => problem.code === "RECORD_NOT_FOUND",
      );
      if (!gone) throw error;
    }
    await saveEntry(listing, { gid: null, handle: listing.metaobjectHandle });
    await writeAudit({
      action: "ListingPageRetired",
      listingId: listing.id,
      details: { redirectedTo: BROWSE_PATH },
    });
  }
  return { deleted };
}
