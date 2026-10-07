// Request log for the production server (F01-FIX-7). Plain Node: no `@/` imports and no app
// code, because `server/start.js` runs outside the Vite build.
//
// A seller link is a credential, so the raw URL never reaches a log line. Query strings are
// always dropped (app proxy signature, emails). Under the app proxy only the words listed
// below are kept; every other segment is replaced, so a new route or token format fails safe.

const MARKER = "[redacted]";
const MAX_PATH = 200;
// DECISION (F01-FIX-7): outside the proxy, a segment longer than this is treated as a secret.
// Database ids (cuid, 25 characters) stay readable; a 43-character token does not.
const MAX_SEGMENT = 32;

// Add a new proxy route segment here, or it is logged as [redacted].
const PROXY_WORDS = new Set([
  "proxy",
  "apps",
  "classifieds",
  "seller",
  "my-link",
  "start",
  "draft",
  "submit",
  "code-request",
  "code-verify",
  "upload-url",
  "upload-complete",
  "photo-delete",
  "photo-order",
  "live",
  "revision",
  "sold",
  "remove",
]);

/** Path and query of a URL as received; nothing is decoded. */
function splitUrl(rawUrl) {
  const local = String(rawUrl ?? "").replace(
    /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i,
    "",
  );
  const cut = local.search(/[?#]/);
  return cut === -1
    ? { path: local, query: "" }
    : { path: local.slice(0, cut), query: local.slice(cut + 1) };
}

function isProxyPath(segments) {
  const first = segments.findIndex((segment) => segment !== "");
  if (first === -1) return false;
  if (segments[first] === "proxy") return true;
  return segments[first] === "apps" && segments[first + 1] === "classifieds";
}

function isSafeSegment(segment, proxy) {
  if (segment === "") return true;
  if (!proxy) return segment.length <= MAX_SEGMENT;
  // React Router asks for `<path>.data` on client navigations.
  const word = segment.endsWith(".data") ? segment.slice(0, -5) : segment;
  return PROXY_WORDS.has(word);
}

/**
 * The path that may be written to a log: no query string, no seller token.
 * @param {string} rawUrl request URL or path, as received
 * @returns {string}
 */
export function redactRequestPath(rawUrl) {
  const segments = splitUrl(rawUrl).path.split("/");
  const proxy = isProxyPath(segments);
  return segments
    .map((segment) => (isSafeSegment(segment, proxy) ? segment : MARKER))
    .join("/")
    .slice(0, MAX_PATH);
}

function decoded(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Removes everything `redactRequestPath` would hide from a free text (an error message or
 * stack) that may quote the request URL.
 * @param {string} text
 * @param {string} rawUrl
 * @returns {string}
 */
export function scrubUrl(text, rawUrl) {
  const { path, query } = splitUrl(rawUrl);
  const segments = path.split("/");
  const proxy = isProxyPath(segments);
  const secrets = segments.filter((segment) => !isSafeSegment(segment, proxy));
  if (query) {
    secrets.push(query);
    for (const pair of query.split("&")) {
      const value = pair.slice(pair.indexOf("=") + 1);
      if (value.length >= 6) secrets.push(value);
    }
  }
  const all = new Set(secrets.flatMap((secret) => [secret, decoded(secret)]));
  let clean = String(text ?? "");
  // Longest first, so a whole query string goes before its parts.
  for (const secret of [...all].sort((a, b) => b.length - a.length)) {
    clean = clean.split(secret).join(MARKER);
  }
  return clean;
}

/**
 * @param {{ method: string, url: string, status: number, ms: number }} entry
 * @returns {string} e.g. `GET /proxy/seller/[redacted]/draft 200 12ms`
 */
export function formatRequestLine({ method, url, status, ms }) {
  return `${method} ${redactRequestPath(url)} ${status} ${ms}ms`;
}

/**
 * Express middleware: one line per finished request. No headers, IP or user agent.
 * @param {(line: string) => void} [log]
 */
export function requestLog(log = console.log) {
  return (req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      log(
        formatRequestLine({
          method: req.method,
          url: req.originalUrl,
          status: res.statusCode,
          ms: Date.now() - startedAt,
        }),
      );
    });
    next();
  };
}
