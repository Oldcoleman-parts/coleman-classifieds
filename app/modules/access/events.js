// What the access module listens to: an ended listing closes its private link.
import { EVENTS, subscribe } from "@/modules/core/index.js";
import { closeInvitationForListing } from "./services/invitations.js";

/** Called from `register()`. */
export function registerListeners() {
  // DECISION: a LAPSED listing keeps its link open, so a staff re-issue works with the same link.
  subscribe(EVENTS.ListingClosed, ({ listingId, reason }) =>
    reason === "LAPSED" ? undefined : closeInvitationForListing(listingId),
  );
  subscribe(EVENTS.ListingRejected, ({ listingId }) =>
    closeInvitationForListing(listingId),
  );
}
