// A small fixed-window rate limiter for public (app proxy) endpoints, shared by every module.
// DECISION (F01-FIX-5): in memory, which is enough for one Railway instance; it resets on deploy.
// Moved from access unchanged (same counting and pruning).
import { isIP } from "node:net";

// Expired windows are pruned once more keys than this are held, so memory stays bounded.
const MAX_KEYS = 10_000;
// Only the start of X-Forwarded-For is read; an IPv6 address fits well inside it.
const MAX_HEADER_CHARS = 512;

/** @type {Map<string, { count: number, resetAt: number }>} */
const windows = new Map();

/**
 * Count one hit and say whether it is allowed. Never logs the key.
 * @param {string} key e.g. `code-request:ip:<ip>`; hash anything personal (an email) first
 * @param {{ limit: number, windowMs: number, now?: number }} options
 * @returns {boolean}
 */
export function rateLimit(key, { limit, windowMs, now = Date.now() }) {
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    if (windows.size > MAX_KEYS) prune(now);
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

// DECISION (F01-FIX-5): pruning scans every key while more than MAX_KEYS are live, as the
// access limiter did. Kept as is; a cheaper structure is a follow-up if it ever shows up.
function prune(now) {
  for (const [key, value] of windows)
    if (value.resetAt <= now) windows.delete(key);
}

/** Clear every window (tests). */
export function resetRateLimits() {
  windows.clear();
}

/** The number of keys held (tests). */
export function rateLimitSize() {
  return windows.size;
}

/**
 * The client IP: the first `X-Forwarded-For` entry (Shopify's proxy and Railway add it).
 * Anything that isn't a plain IPv4 or IPv6 address becomes "unknown", so a junk header
 * can't make a new key per request.
 * DECISION (F01-FIX-5): a port or brackets ("1.2.3.4:80", "[::1]") are not parsed; they
 * are "unknown". The first entry is trusted as before: Shopify's proxy sets it.
 * @param {Request} request
 * @returns {string}
 */
export function clientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded
    ?.slice(0, MAX_HEADER_CHARS)
    .split(",")[0]
    ?.trim()
    .toLowerCase();
  return first && isIP(first) !== 0 ? first : "unknown";
}
