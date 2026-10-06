// What the media module listens to. Approving, publishing and unpublishing are safe to
// repeat, so a repeated event changes nothing. Only photos staff approved are published.
import { EVENTS, subscribe } from "@/modules/core/index.js";
import { approvePhotos } from "./services/approval.js";
import { publish, unpublish } from "./services/publish.js";

/** Called from `register()`. */
export function registerListeners() {
  // Approval is recorded now; nothing is public until the listing goes live (after payment).
  subscribe(EVENTS.ListingApproved, async ({ listingId, photoIds }) => {
    // A re-issued listing carries no photoIds: it approves nothing new.
    if (photoIds) await approvePhotos(listingId, photoIds);
  });
  subscribe(EVENTS.ListingWentLive, ({ listingId }) => publish(listingId));
  subscribe(EVENTS.RevisionApproved, async ({ listingId, photoIds }) => {
    await approvePhotos(listingId, photoIds ?? []);
    await publish(listingId);
  });
  subscribe(EVENTS.ListingClosed, ({ listingId }) => unpublish(listingId));
}
