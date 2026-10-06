// Email problems staff should know about (sends that keep failing, high bounce rates).
// DECISION: `ops` (F08) owns incidents and doesn't exist yet. Until then a problem is an
// audit entry and a log line; F08-T2 replaces the body of `reportEmailProblem()` with
// `ops.raiseIncident()`. This is the only place that needs to change.
import { writeAudit } from "@/modules/core/index.js";

const REPEAT_AFTER_MS = 24 * 60 * 60 * 1000;
/** @type {Map<string, number>} problem key → when it was last reported */
const reported = new Map();

/**
 * @param {string} key identifies the problem, e.g. "email-dead:staff_review_needed"
 * @param {string} message a fixed description: no addresses, names or email content
 * @param {Record<string, string | number>} [details] ids, codes and counts only
 * @param {{ now?: Date }} [options]
 * @returns {Promise<boolean>} false when the same problem was reported in the last day
 */
export async function reportEmailProblem(
  key,
  message,
  details = {},
  { now = new Date() } = {},
) {
  const last = reported.get(key);
  if (last !== undefined && now.getTime() - last < REPEAT_AFTER_MS)
    return false;
  reported.set(key, now.getTime());
  await writeAudit({
    action: "EmailProblem",
    details: { key, kind: "EMAIL", message, ...details },
  });
  console.error(`[email] problem ${key}`);
  return true;
}

/** Forget what was reported. For tests. */
export function resetEmailProblems() {
  reported.clear();
}
