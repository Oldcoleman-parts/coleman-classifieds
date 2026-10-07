// Browser-safe helpers for the console screens. A separate entry from `index.js`, which
// needs the server.

// Badge tones from the admin UI rules: needs review = warning, live = success,
// awaiting payment = info, closed = default.
export const STATUS_BADGE = {
  INVITED: ["Invited", "neutral"],
  DRAFT: ["Draft with seller", "neutral"],
  SUBMITTED: ["Needs review", "warning"],
  CHANGES_REQUESTED: ["Changes requested", "neutral"],
  APPROVED_AWAITING_PAYMENT: ["Awaiting payment", "info"],
  LIVE: ["Live", "success"],
  PAUSED: ["Paused", "caution"],
  PAYMENT_OVERDUE: ["Payment overdue", "critical"],
  SOLD: ["Sold", "neutral"],
  EXPIRED: ["Expired", "neutral"],
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
