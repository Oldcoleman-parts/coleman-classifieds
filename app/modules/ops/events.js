// What the ops module listens to.
import { EVENTS, subscribe } from "@/modules/core/index.js";
import { onListingClosed } from "./services/closed-email.js";

export function registerListeners() {
  subscribe(EVENTS.ListingClosed, onListingClosed);
}
