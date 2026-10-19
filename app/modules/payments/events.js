// What the payments module listens to.
import prisma from "@/db.server";
import { EVENTS, subscribe } from "@/modules/core/index.js";
import { onListingApproved } from "./services/approval.js";
import { deleteDiscount } from "./services/discount.js";
import { offlineAdmin } from "./services/shop.js";

/**
 * A closed listing no longer needs its discount code. A failure is logged by the event bus;
 * the lapse task deletes what is left over.
 * @param {{ listingId: string }} payload
 */
async function onListingClosed({ listingId }) {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { id: true, discountCodeId: true },
  });
  if (!listing?.discountCodeId) return;
  await deleteDiscount(listing, { admin: await offlineAdmin() });
}

/** Called from `register()`. */
export function registerListeners() {
  // An approval and a staff re-issue of a lapsed listing both publish ListingApproved.
  subscribe(EVENTS.ListingApproved, onListingApproved);
  subscribe(EVENTS.ListingClosed, onListingClosed);
}
