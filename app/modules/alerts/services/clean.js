// The subscriber's address, checked before it is stored or reaches an email header.
import { createHash } from "node:crypto";
import { requireEmail, ValidationError } from "@/modules/core/index.js";

/**
 * A CR, LF or other control character anywhere is refused, not repaired, because it can only
 * be an injection attempt.
 * DECISION (F07-T2): a copy of contact's check (alerts may not import its services/).
 * @param {unknown} value
 * @returns {string} lowercase
 */
export function cleanEmail(value) {
  // eslint-disable-next-line no-control-regex
  if (typeof value === "string" && /[\u0000-\u001f\u007f]/.test(value.trim()))
    throw new ValidationError("email is not valid", {
      email: "must be a valid email address",
    });
  return requireEmail(value, "email");
}

/**
 * The address as a rate-limit key, so addresses never sit in the limiter.
 * @param {string} email
 * @returns {string} hex sha256 of email + TOKEN_PEPPER
 */
export function emailKey(email) {
  const pepper = process.env.TOKEN_PEPPER;
  if (!pepper) throw new Error("TOKEN_PEPPER is not set");
  return createHash("sha256")
    .update(email + pepper)
    .digest("hex");
}
