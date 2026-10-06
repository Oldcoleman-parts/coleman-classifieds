// Immediate notices to OCP staff: a listing needs review or a buyer message was held.
// They go only to the addresses in EmailSettings.staffNotify and say only the listing
// title, what changed and where to review it.
import { ValidationError } from "@/modules/core/index.js";
import { getEmailSettings } from "./email-settings.js";
import { send } from "./outbox.js";

const CHANGE_TYPES = {
  NEW: "new listing",
  CORRECTED: "corrected",
  EDIT: "edit",
};
const MAX_TITLE = 120;

/**
 * A link that opens a screen of this app inside Shopify admin.
 * @param {string} path the app path, e.g. "/app/listings/abc"
 * @returns {string}
 */
export function adminLink(path) {
  const shop = process.env.SHOP_DOMAIN;
  // Without the shop's domain the link opens the app directly, which then asks to log in.
  return shop
    ? `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}${path}`
    : `${process.env.SHOPIFY_APP_URL}${path}`;
}

/**
 * Email every staff notification address.
 * @param {"NEW" | "CORRECTED" | "EDIT" | "MESSAGE_HELD"} kind
 * @param {{ id: string, title?: string | null }} listing
 * @param {string} link where staff review it (an https link)
 * @param {{ reasons?: string[], dedupeKey?: string }} [extra] `reasons` are the hold reason
 *   codes for MESSAGE_HELD; `dedupeKey` makes a repeated call send nothing new
 * @returns {Promise<{ sent: number }>} how many addresses were emailed or queued
 */
export async function notifyStaff(kind, listing, link, extra = {}) {
  const held = kind === "MESSAGE_HELD";
  if (!held && !Object.hasOwn(CHANGE_TYPES, kind))
    throw new ValidationError("Unknown staff notice", {
      kind: "is not valid",
    });
  const { staffNotify } = await getEmailSettings();
  const title =
    (listing.title ?? "").trim().slice(0, MAX_TITLE) || "Untitled listing";
  const vars = held
    ? {
        listing_title: title,
        review_link: link,
        // Reason codes only: never the buyer's words.
        hold_reasons:
          (extra.reasons ?? [])
            .filter((reason) => /^[A-Z_]{1,40}$/.test(reason))
            .join(", ") || "held",
      }
    : {
        listing_title: title,
        review_link: link,
        change_type: CHANGE_TYPES[kind],
      };

  let sent = 0;
  for (const to of new Set(staffNotify)) {
    const { status } = await send(
      held ? "staff_message_held" : "staff_review_needed",
      to,
      vars,
      extra.dedupeKey
        ? { idempotencyKey: `staff:${extra.dedupeKey}:${to}` }
        : {},
    );
    if (status === "SENT" || status === "PENDING") sent += 1;
  }
  return { sent };
}
