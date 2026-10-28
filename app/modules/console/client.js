// Browser-safe helpers for the console screens. A separate entry from `index.js`, which
// needs the server.

// Badge tones from the admin UI rules: needs review = warning, live = success,
// awaiting payment = info, sold = success, expired = caution, other closed = neutral.
export const STATUS_BADGE = {
  INVITED: ["Invited", "neutral"],
  DRAFT: ["Draft with seller", "neutral"],
  SUBMITTED: ["Needs review", "warning"],
  CHANGES_REQUESTED: ["Changes requested", "neutral"],
  APPROVED_AWAITING_PAYMENT: ["Awaiting payment", "info"],
  LIVE: ["Live", "success"],
  PAUSED: ["Paused", "caution"],
  PAYMENT_OVERDUE: ["Payment overdue", "critical"],
  SOLD: ["Sold", "success"],
  EXPIRED: ["Expired", "caution"],
  REMOVED: ["Removed", "neutral"],
  REJECTED: ["Declined", "neutral"],
  LAPSED: ["Lapsed", "neutral"],
};

/**
 * @param {string} status
 * @returns {[string, string]} label and badge tone
 */
export const statusBadge = (status) =>
  STATUS_BADGE[status] ?? [status, "neutral"];

/** @param {number | null} cents */
export const dollars = (cents) =>
  cents === null || cents === undefined ? "—" : `$${(cents / 100).toFixed(2)}`;

// Audit actions whose name alone doesn't read well on the history timeline.
const HISTORY_LABELS = {
  ListingWentLive: "Listing went live",
  ListingUpdatedImmediate: "Seller updated the listing",
  StaffWordingEdited: "Staff edited the wording",
  HistoryExported: "History exported",
};

/**
 * @param {string} action an audit action, for example "ListingApproved"
 * @returns {string} "Listing approved"
 */
export function historyLabel(action) {
  if (HISTORY_LABELS[action]) return HISTORY_LABELS[action];
  const words = action.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return words.charAt(0) + words.slice(1).toLowerCase();
}
