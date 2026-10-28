// The "this device has entered the code" credential, valid for 30 days.
// DECISION: Shopify's app proxy strips `Cookie` and `Set-Cookie`, so the credential can't be an
// HttpOnly cookie. The verify page hands it to a small script that keeps it in localStorage
// and sends it back as the `device` form field (or the `X-CC-Device` header). It is signed and
// bound to one invitation, so a copied credential opens nothing else.
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { pepper } from "./tokens.js";

export const DEVICE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const key = () =>
  Buffer.from(hkdfSync("sha256", pepper(), "", "cc-device-v1", 32));

const sign = (payload) =>
  createHmac("sha256", key()).update(payload).digest("base64url");

/**
 * @param {string} invitationId
 * @param {{ now?: Date }} [options]
 * @returns {string} `payload.signature`, both base64url
 */
export function issueDeviceCredential(invitationId, { now = new Date() } = {}) {
  const payload = Buffer.from(
    JSON.stringify({
      i: invitationId,
      e: now.getTime() + DEVICE_DAYS * DAY_MS,
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/**
 * @param {unknown} credential
 * @param {string} invitationId
 * @param {{ now?: Date }} [options]
 * @returns {boolean} signed by us, for this invitation and not expired
 */
export function checkDeviceCredential(
  credential,
  invitationId,
  { now = new Date() } = {},
) {
  if (typeof credential !== "string" || credential.length > 512) return false;
  const [payload, signature, extra] = credential.split(".");
  if (!payload || !signature || extra !== undefined) return false;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return false;
  try {
    const { i, e } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return i === invitationId && typeof e === "number" && e > now.getTime();
  } catch {
    return false;
  }
}

/**
 * The credential sent with a request: the `X-CC-Device` header, else the `device` form field.
 * @param {Request} request
 * @param {FormData | null} [form]
 * @returns {string | null}
 */
export function deviceFrom(request, form = null) {
  const header = request.headers.get("x-cc-device");
  if (header) return header;
  const field = form?.get("device");
  return typeof field === "string" && field ? field : null;
}
