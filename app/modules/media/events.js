// What the media module listens to. Publishing and unpublishing are safe to repeat, so a
// repeated event changes nothing.
import { EVENTS, subscribe } from "@/modules/core/index.js";
import { publish, unpublish } from "./services/publish.js";

/** Called from `register()`. */
export function registerListeners() {
  subscribe(EVENTS.ListingWentLive, ({ listingId }) => publish(listingId));
  subscribe(EVENTS.RevisionApproved, ({ listingId }) => publish(listingId));
  subscribe(EVENTS.ListingClosed, ({ listingId }) => unpublish(listingId));
}
