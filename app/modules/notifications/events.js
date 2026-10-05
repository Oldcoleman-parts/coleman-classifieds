// What the notifications module listens to. A repeated event sends nothing new: each notice
// is keyed on the event's audit id.
import { EVENTS, getListingSummary, subscribe } from "@/modules/core/index.js";
import { adminLink, notifyStaff } from "./services/staff-notices.js";

/**
 * @param {"NEW" | "CORRECTED" | "EDIT" | "MESSAGE_HELD"} kind
 * @param {string} listingId
 * @param {string} path
 * @param {{ auditId: string }} meta
 * @param {string[]} [reasons]
 */
async function notify(kind, listingId, path, meta, reasons) {
  const listing = await getListingSummary(listingId);
  if (!listing) return;
  await notifyStaff(kind, listing, adminLink(path), {
    reasons,
    dedupeKey: meta.auditId,
  });
}

/** Called from `register()`. */
export function registerListeners() {
  subscribe(EVENTS.ListingSubmitted, ({ listingId, kind }, meta) =>
    notify(
      kind === "CORRECTED" ? "CORRECTED" : "NEW",
      listingId,
      `/app/listings/${listingId}`,
      meta,
    ),
  );
  subscribe(EVENTS.RevisionSubmitted, ({ listingId }, meta) =>
    notify("EDIT", listingId, `/app/listings/${listingId}`, meta),
  );
  subscribe(EVENTS.BuyerMessageHeld, ({ listingId, reasons }, meta) =>
    notify("MESSAGE_HELD", listingId, "/app/messages", meta, reasons),
  );
  // `IncidentRaised` is handled in F08-T2: `ops` owns the incident and its message, and
  // sends the `ops_incident` email through `send()`.
}
