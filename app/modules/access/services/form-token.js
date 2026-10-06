// The CSRF token on every seller POST. The app proxy strips cookies, so it can't be a cookie
// pair: it is a signed, short-lived value bound to one invitation, issued with each page.
// DECISION (F04-T2): HMAC with a key derived from TOKEN_PEPPER ("cc-form-v1"), valid 24 hours.
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { pepper } from "./tokens.js";

const VALID_MS = 24 * 60 * 60 * 1000;

const key = () =>
  Buffer.from(hkdfSync("sha256", pepper(), "", "cc-form-v1", 32));

const sign = (payload) =>
  createHmac("sha256", key()).update(payload).digest("base64url");

/**
 * @param {string} invitationId
 * @param {{ now?: Date }} [options]
 * @returns {string} `payload.signature`, both base64url
 */
export function issueFormToken(invitationId, { now = new Date() } = {}) {
  const payload = Buffer.from(
    JSON.stringify({ f: invitationId, e: now.getTime() + VALID_MS }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/**
 * @param {unknown} value
 * @param {string} invitationId
 * @param {{ now?: Date }} [options]
 * @returns {boolean} signed by us, for this invitation and not expired
 */
export function checkFormToken(value, invitationId, { now = new Date() } = {}) {
  if (typeof value !== "string" || value.length > 512) return false;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) return false;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return false;
  try {
    const { f, e } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return f === invitationId && typeof e === "number" && e > now.getTime();
  } catch {
    return false;
  }
}

/**
 * The form token sent with a request: the `X-CC-Form` header, else the `csrf` form field.
 * @param {Request} request
 * @param {FormData | null} [form]
 * @returns {string | null}
 */
export function formTokenFrom(request, form = null) {
  const header = request.headers.get("x-cc-form");
  if (header) return header;
  const field = form?.get("csrf");
  return typeof field === "string" && field ? field : null;
}
