// The private payment link in the `approved_pay` and `payment_reminder` emails.
// DECISION (F06-T1): only the hash of a seller link is stored, so the app cannot rebuild
// one for an email. The pay link is its own signed reference, `<listingId>.<signature>`:
// nothing is stored, it stops working when the payment deadline changes (a re-issue), and
// all it can do is open the pay page of that one listing. Never log it.
import { createHmac, timingSafeEqual } from "node:crypto";
import { PAY_PATH } from "./constants.js";
import { derivedKey } from "./crypto.js";

const REF_RE = /^([a-z0-9]{1,40})\.([A-Za-z0-9_-]{43})$/;

/**
 * @param {string} listingId
 * @param {Date} paymentDueBy
 * @returns {string} base64url HMAC-SHA256
 */
const sign = (listingId, paymentDueBy) =>
  createHmac("sha256", derivedKey("cc-pay-v1"))
    .update(`${listingId}:${paymentDueBy.getTime()}`)
    .digest("base64url");

/**
 * @param {string} listingId
 * @param {Date} paymentDueBy
 * @returns {string}
 */
export const payRef = (listingId, paymentDueBy) =>
  `${listingId}.${sign(listingId, paymentDueBy)}`;

/**
 * @param {unknown} ref from the URL
 * @returns {{ listingId: string, signature: string } | null}
 */
export function readPayRef(ref) {
  const match = typeof ref === "string" ? REF_RE.exec(ref) : null;
  return match ? { listingId: match[1], signature: match[2] } : null;
}

/**
 * @param {{ listingId: string, signature: string }} ref
 * @param {{ id: string, paymentDueBy: Date | null } | null} payable
 * @returns {boolean} signed by us for this listing and its current deadline (constant time)
 */
export function checkPayRef(ref, payable) {
  if (!payable?.paymentDueBy || payable.id !== ref.listingId) return false;
  const expected = Buffer.from(sign(payable.id, payable.paymentDueBy));
  const given = Buffer.from(ref.signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * @param {string} base the storefront address (https, no trailing slash)
 * @param {string} listingId
 * @param {Date} paymentDueBy
 * @returns {string}
 */
export const payLink = (base, listingId, paymentDueBy) =>
  `${base}${PAY_PATH}/${payRef(listingId, paymentDueBy)}`;
