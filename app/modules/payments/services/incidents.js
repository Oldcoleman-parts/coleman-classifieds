// Payment problems staff must look at (a mismatched order, a late payment, a refund).
// DECISION (F06-T1): `ops` (F08) owns incidents and doesn't exist yet. Until then a problem
// is an audit entry and a log line, as `notifications.reportEmailProblem()` does; F08-T2
// replaces the body of `reportPaymentProblem()` with `ops.raiseIncident()`.
import { writeAudit } from "@/modules/core/index.js";
import { DAY_MS } from "./constants.js";

/** @type {Map<string, number>} problem key → when it was last reported */
const reported = new Map();

/**
 * @param {string} key identifies the problem, e.g. "fee-mismatch:<orderGid>"
 * @param {string} message a fixed description: no names, addresses or amounts typed by people
 * @param {Record<string, string | number | null>} [details] ids, codes and counts only
 * @param {{ listingId?: string | null, now?: Date }} [options] `listingId` must exist
 * @returns {Promise<boolean>} false when the same problem was reported in the last day
 */
export async function reportPaymentProblem(
  key,
  message,
  details = {},
  { listingId = null, now = new Date() } = {},
) {
  const last = reported.get(key);
  if (last !== undefined && now.getTime() - last < DAY_MS) return false;
  reported.set(key, now.getTime());
  await writeAudit({
    action: "PaymentProblem",
    listingId,
    details: { key, kind: "PAYMENT", message, ...details },
  });
  console.error(`[payments] problem ${key}`);
  return true;
}

/** Forget what was reported. For tests. */
export function resetPaymentProblems() {
  reported.clear();
}
