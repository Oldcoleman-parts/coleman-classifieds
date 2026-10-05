// Where each photo lives in the bucket. Names are random ids only: never a seller's name,
// email or anything else that says who or what the photo is.
import { randomBytes } from "node:crypto";
import { requireId, ValidationError } from "@/modules/core/index.js";
import { VARIANTS } from "./limits.js";
import { mediaConfig } from "./aws-clients.js";

const PHOTO_ID_RE = /^[a-f0-9]{24}$/;

/** @returns {string} a new random photo id */
export const newPhotoId = () => randomBytes(12).toString("hex");

/**
 * @param {unknown} value
 * @returns {string}
 * @throws {ValidationError}
 */
export function requirePhotoId(value) {
  if (typeof value !== "string" || !PHOTO_ID_RE.test(value))
    throw new ValidationError("photoId is not valid", {
      photoId: "is not a valid id",
    });
  return value;
}

/**
 * The browser uploads here. Nothing in `incoming/` is ever shown to anyone.
 * @param {string} listingId
 * @param {string} photoId
 */
export const incomingKey = (listingId, photoId) =>
  `incoming/${requireId(listingId, "listingId")}/${requirePhotoId(photoId)}`;

/**
 * The cleaned original, readable only through short-lived links.
 * @param {string} listingId
 * @param {string} photoId
 */
export const privateKey = (listingId, photoId) =>
  `private/${requireId(listingId, "listingId")}/${requirePhotoId(photoId)}.jpg`;

/**
 * A new, unguessable name for a photo's public copies. It is not the photo id, so a public
 * address says nothing about the private one and is never reused after an unpublish.
 * @param {string} listingId
 */
export const newPublicBase = (listingId) =>
  `public/${requireId(listingId, "listingId")}/${randomBytes(16).toString("hex")}`;

/**
 * @param {string} base from `newPublicBase()`
 * @param {keyof typeof VARIANTS} size
 */
export const variantKey = (base, size) => `${base}_${size}.jpg`;

/**
 * @param {string} base
 * @returns {string[]} the keys of every public copy
 */
export const variantKeys = (base) =>
  Object.keys(VARIANTS).map((size) =>
    variantKey(base, /** @type {keyof typeof VARIANTS} */ (size)),
  );

/**
 * The public address of one copy. Always on the CloudFront domain, never an S3 address.
 * @param {string} base
 * @param {keyof typeof VARIANTS} [size]
 */
export const publicUrl = (base, size = "large") =>
  `https://${mediaConfig().domain}/${variantKey(base, size)}`;
