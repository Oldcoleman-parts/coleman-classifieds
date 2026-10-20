// Buyer input, cleaned before it is stored or reaches an email header.
import { createHash } from "node:crypto";
import { requireEmail, ValidationError } from "@/modules/core/index.js";

export const MAX_NAME = 100;
export const MAX_BODY = 2000;

// Every control character, CR, LF and tab included.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
// The body keeps its line breaks (LF only).
// eslint-disable-next-line no-control-regex
const CONTROL_BUT_LF = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/g;

/** @param {string} field @param {string} problem */
const fail = (field, problem) => {
  throw new ValidationError(`${field} is not valid`, { [field]: problem });
};

/**
 * The buyer's name, one line: control characters become spaces (no header injection).
 * @param {unknown} value
 * @returns {string}
 */
export function cleanName(value) {
  if (typeof value !== "string") fail("name", "is required");
  const text = value.normalize("NFKC").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (text === "") fail("name", "is required");
  if (text.length > MAX_NAME) fail("name", `must be at most ${MAX_NAME} characters`);
  return text;
}

/**
 * The buyer's address, used only as the Reply-To. A CR or LF anywhere is refused, not
 * repaired, because it can only be an injection attempt.
 * @param {unknown} value
 * @returns {string} lowercase
 */
export function cleanEmail(value) {
  // eslint-disable-next-line no-control-regex
  if (typeof value === "string" && /[\u0000-\u001f\u007f]/.test(value.trim()))
    fail("email", "must be a valid email address");
  return requireEmail(value, "email");
}

/**
 * The message: line endings become LF, other control characters are removed.
 * @param {unknown} value
 * @returns {string}
 */
export function cleanBody(value) {
  if (typeof value !== "string") fail("message", "is required");
  const text = value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_BUT_LF, "")
    .trim();
  if (text === "") fail("message", "is required");
  if (text.length > MAX_BODY)
    fail("message", `must be at most ${MAX_BODY} characters`);
  return text;
}

/**
 * The buyer address as a rate-limit key, so addresses never sit in the limiter.
 * @param {string} email
 * @returns {string} hex sha256 of email + TOKEN_PEPPER
 */
export function buyerKey(email) {
  const pepper = process.env.TOKEN_PEPPER;
  if (!pepper) throw new Error("TOKEN_PEPPER is not set");
  return createHash("sha256").update(email + pepper).digest("hex");
}
