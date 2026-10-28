// Private invitation links. Only `sha256(token + TOKEN_PEPPER)` is stored; the token itself is
// shown to staff once and is never logged, stored or put in an error message.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** @returns {string} the pepper; refuses to run without one */
export function pepper() {
  const value = process.env.TOKEN_PEPPER;
  if (!value) throw new Error("TOKEN_PEPPER is not set");
  return value;
}

/** @returns {string} 32 random bytes, base64url (43 characters) */
export function newToken() {
  return randomBytes(32).toString("base64url");
}

/**
 * @param {string} value a token or code, plus any context it is bound to
 * @returns {string} hex sha256 of value + pepper
 */
export function hashSecret(value) {
  return createHash("sha256")
    .update(value + pepper())
    .digest("hex");
}

/** @param {unknown} token */
export function isWellFormedToken(token) {
  return typeof token === "string" && TOKEN_RE.test(token);
}

/**
 * Constant-time comparison of two hex digests.
 * @param {string} a
 * @param {string} b
 */
export function safeEqualHex(a, b) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}
