// A small fixed-window rate limiter for the pay page.
// DECISION (F06-T1): a copy of the access module's limiter, which it doesn't export. In
// memory, enough for one instance. Follow-up: a shared `platform.rateLimit()`.

/** @type {Map<string, { count: number, resetAt: number }>} */
const windows = new Map();

/**
 * Count one hit and say whether it is allowed.
 * @param {string} key e.g. `pay:ip:<ip>`
 * @param {{ limit: number, windowMs: number, now?: number }} options
 * @returns {boolean}
 */
export function hit(key, { limit, windowMs, now = Date.now() }) {
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    if (windows.size > 10_000)
      for (const [name, value] of windows)
        if (value.resetAt <= now) windows.delete(name);
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

/** Clear every window (tests). */
export function resetPayLimits() {
  windows.clear();
}

/**
 * The client IP: the first `X-Forwarded-For` entry (Shopify's proxy and Railway add it).
 * @param {Request} request
 * @returns {string}
 */
export function clientIp(request) {
  const first = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || "unknown";
}
