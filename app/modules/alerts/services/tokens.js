// Confirm and unsubscribe tokens. A token is `<subscriber id>.<secret>`; only
// sha256(token + TOKEN_PEPPER) is stored, it is compared in constant time and never logged.
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const TOKEN_RE = /^([a-z0-9]{8,40})\.([A-Za-z0-9_-]{43})$/;

function pepper() {
  const value = process.env.TOKEN_PEPPER;
  if (!value) throw new Error("TOKEN_PEPPER is not set");
  return value;
}

/** @returns {string} a new subscriber id (hex), so the tokens can carry it */
export const newSubscriberId = () => randomBytes(12).toString("hex");

/**
 * @param {string} token
 * @returns {string} hex sha256 of token + TOKEN_PEPPER
 */
export const hashToken = (token) =>
  createHash("sha256")
    .update(token + pepper())
    .digest("hex");

/**
 * A one-time confirm token: random, so it can't be worked out again.
 * @param {string} id
 * @returns {string}
 */
export const confirmToken = (id) =>
  `${id}.${randomBytes(32).toString("base64url")}`;

/**
 * The unsubscribe token. DECISION (F07-T2): it is an HMAC of the id, not random, so every
 * alert email can carry it although only its hash is stored. Changing TOKEN_PEPPER breaks the
 * links already sent.
 * @param {string} id
 * @returns {string}
 */
export function unsubscribeToken(id) {
  const key = createHash("sha256")
    .update(`alerts-unsubscribe:${pepper()}`)
    .digest();
  return `${id}.${createHmac("sha256", key).update(id).digest("base64url")}`;
}

/**
 * @param {unknown} token
 * @returns {string | null} the subscriber id, or null when it isn't a token's shape
 */
export function tokenId(token) {
  if (typeof token !== "string") return null;
  return TOKEN_RE.exec(token)?.[1] ?? null;
}

/**
 * @param {string} token
 * @param {string | null | undefined} storedHash
 * @returns {boolean}
 */
export function matches(token, storedHash) {
  if (typeof storedHash !== "string" || storedHash.length !== 64) return false;
  const presented = Buffer.from(hashToken(token), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return (
    stored.length === presented.length && timingSafeEqual(presented, stored)
  );
}
