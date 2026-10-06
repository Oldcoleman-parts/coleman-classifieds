// The limits for seller photos. Changing one here changes it everywhere.

// What a browser may say it is uploading. The real type is read from the file's bytes later.
export const UPLOAD_TYPES = /** @type {const} */ ([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export const MAX_BYTES = 15 * 1024 * 1024;
// Decompression-bomb guard: a photo may not decode to more pixels than this.
export const MAX_PIXELS = 50_000_000;
// Upload and preview links last ten minutes.
export const URL_TTL_SECONDS = 600;

// The stored original: long edge in pixels, JPEG quality.
export const PRIVATE_MAX_EDGE = 2560;
export const PRIVATE_QUALITY = 85;

// The public copies made when a listing is published: name → long edge in pixels.
export const VARIANTS = /** @type {const} */ ({
  thumb: 320,
  medium: 800,
  large: 1600,
});
export const VARIANT_QUALITY = 80;
