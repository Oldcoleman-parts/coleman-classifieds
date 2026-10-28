// Storefront problems staff must look at (a listing page that couldn't be written).
// DECISION (F06-T2): `ops` (F08) owns incidents and doesn't exist yet. Until then a problem
// is an audit entry and a log line, as payments does; F08-T2 replaces the body of
// `reportPublishingProblem()` with `ops.raiseIncident()` (kind PUBLISHING).
import { writeAudit } from "@/modules/core/index.js";
import { DAY_MS } from "./constants.js";

/** @type {Map<string, number>} problem key → when it was last reported */
const reported = new Map();

/**
 * @param {string} key identifies the problem, e.g. "sync:<listingId>"
 * @param {string} message a fixed description: nothing typed by people
 * @param {Record<string, string | number | null>} [details] ids, codes and counts only
 * @param {{ listingId?: string | null, now?: Date }} [options] `listingId` must exist
 * @returns {Promise<boolean>} false when the same problem was reported in the last day
 */
export async function reportPublishingProblem(
  key,
  message,
  details = {},
  { listingId = null, now = new Date() } = {},
) {
  const last = reported.get(key);
  if (last !== undefined && now.getTime() - last < DAY_MS) return false;
  reported.set(key, now.getTime());
  await writeAudit({
    action: "PublishingProblem",
    listingId,
    details: { key, kind: "PUBLISHING", message, ...details },
  });
  console.error(`[publishing] problem ${key}`);
  return true;
}

/** Forget what was reported. For tests. */
export function resetPublishingProblems() {
  reported.clear();
}

/** @param {unknown} error @returns {string} a code or error name, never a message */
export const errorCode = (error) =>
  /** @type {any} */ (error)?.code ??
  /** @type {any} */ (error)?.name ??
  "Error";
