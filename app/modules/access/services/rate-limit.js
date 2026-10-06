// A small fixed-window rate limiter for the public seller endpoints.
// DECISION: in memory, which is enough for one Railway instance; it resets on deploy.
// Follow-up: a shared `platform.rateLimit()` (F07 needs one too).

/** @type {Map<string, { count: number, resetAt: number }>} */
const windows = new Map();

/**
 * Count one hit and say whether it is allowed.
 * @param {string} key e.g. `code-request:ip:<ip>`
 * @param {{ limit: number, windowMs: number, now?: number }} options
 * @returns {boolean}
 */
export function hit(key, { limit, windowMs, now = Date.now() }) {
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    if (windows.size > 10_000) prune(now);
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

function prune(now) {
  for (const [key, value] of windows)
    if (value.resetAt <= now) windows.delete(key);
}

/** Clear every window (tests). */
export function resetRateLimits() {
  windows.clear();
}

/**
 * The client IP: the first `X-Forwarded-For` entry (Shopify's proxy and Railway add it).
 * @param {Request} request
 * @returns {string}
 */
export function clientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || "unknown";
}
