// Turns whatever was uploaded into a clean JPEG. The file is recognised by its first bytes,
// not its name, then decoded and written out again: that drops EXIF, GPS, XMP and colour
// profiles, and anything hidden in the file that isn't picture data.
import decodeHeic from "heic-decode";
import sharp from "sharp";
import { ValidationError } from "@/modules/core/index.js";
import {
  MAX_BYTES,
  MAX_PIXELS,
  PRIVATE_MAX_EDGE,
  PRIVATE_QUALITY,
  VARIANT_QUALITY,
  VARIANTS,
} from "./limits.js";

// The HEIC kinds the decoder reads (the "major brand" at bytes 8–11).
const HEIC_BRANDS = ["heic", "heix", "hevc", "hevx", "mif1", "msf1"];

/**
 * @param {string} problem
 * @returns {never}
 */
function fail(problem) {
  throw new ValidationError(`photo ${problem}`, { photo: problem });
}

/**
 * @param {Uint8Array} bytes
 * @returns {"jpeg" | "png" | "webp" | "heic" | null} from the file's first bytes
 */
export function sniffImageType(bytes) {
  const ascii = (start, end) =>
    String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpeg";
  if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(4, 8) === "ftyp" && HEIC_BRANDS.includes(ascii(8, 12)))
    return "heic";
  return null;
}

/**
 * sharp's ready-made builds can't read HEIC (the iPhone format), so it is decoded to raw
 * pixels first. The size is checked before any pixels are decoded.
 * @param {Uint8Array} bytes
 * @returns {Promise<import("sharp").Sharp>}
 */
async function openHeic(bytes) {
  const images = await decodeHeic.all({ buffer: bytes });
  try {
    const first = images[0];
    if (first.width * first.height > MAX_PIXELS) fail("is too large");
    const { width, height, data } = await first.decode();
    return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
      raw: { width, height, channels: 4 },
      limitInputPixels: MAX_PIXELS,
    });
  } finally {
    images.dispose();
  }
}

/**
 * @param {Uint8Array} bytes the uploaded file
 * @returns {Promise<{ jpeg: Buffer, width: number, height: number }>} a JPEG with no
 *   metadata, turned the right way up and no larger than the stored size
 * @throws {ValidationError} when the file is not a photo the app accepts
 */
export async function processImage(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0)
    fail("is not a supported image");
  if (bytes.length > MAX_BYTES) fail("is too large");
  const type = sniffImageType(bytes);
  if (!type) fail("is not a supported image");
  try {
    const image =
      type === "heic"
        ? await openHeic(bytes)
        : // `.rotate()` with no angle turns the picture as its EXIF orientation says,
          // before that tag is dropped with the rest of the metadata.
          sharp(bytes, {
            limitInputPixels: MAX_PIXELS,
            failOn: "error",
          }).rotate();
    const { data, info } = await image
      .resize({
        width: PRIVATE_MAX_EDGE,
        height: PRIVATE_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      // No `withMetadata()`: sharp writes no EXIF, GPS, XMP or ICC unless asked to.
      .jpeg({ quality: PRIVATE_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { jpeg: data, width: info.width, height: info.height };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    // The decoder's own message can quote file contents, so only its absence is reported.
    return fail(
      /pixel limit/i.test(String(error?.message))
        ? "is too large"
        : "could not be read",
    );
  }
}

/**
 * The public copies of a stored photo.
 * @param {Uint8Array} jpeg a private original made by `processImage()`
 * @returns {Promise<Record<keyof typeof VARIANTS, Buffer>>}
 */
export async function makeVariants(jpeg) {
  const entries = await Promise.all(
    Object.entries(VARIANTS).map(async ([size, edge]) => [
      size,
      await sharp(jpeg, { limitInputPixels: MAX_PIXELS })
        .resize({
          width: edge,
          height: edge,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: VARIANT_QUALITY })
        .toBuffer(),
    ]),
  );
  return Object.fromEntries(entries);
}
