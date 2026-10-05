// Small S3 helpers shared by the photo services.
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getS3Client, mediaConfig } from "./aws-clients.js";

/**
 * @param {string} key
 * @param {{ maxBytes?: number }} [options] refuse to download anything larger
 * @returns {Promise<Uint8Array | null>} null when there is no such object
 * @throws {RangeError} when the object is larger than `maxBytes`
 */
export async function readObject(key, { maxBytes } = {}) {
  let response;
  try {
    response = await getS3Client().send(
      new GetObjectCommand({ Bucket: mediaConfig().bucket, Key: key }),
    );
  } catch (error) {
    if (error?.name === "NoSuchKey" || error?.name === "NotFound") return null;
    throw error;
  }
  // The size is checked before the body is read, so an oversized file is never loaded.
  if (maxBytes !== undefined && Number(response.ContentLength) > maxBytes)
    throw new RangeError("object is too large");
  return response.Body.transformToByteArray();
}

/**
 * @param {string} key
 * @param {Uint8Array} body a JPEG
 * @param {{ cacheControl?: string }} [options]
 */
export async function writeJpeg(key, body, { cacheControl } = {}) {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: mediaConfig().bucket,
      Key: key,
      Body: body,
      ContentType: "image/jpeg",
      ...(cacheControl ? { CacheControl: cacheControl } : {}),
    }),
  );
}

/**
 * Delete objects. Deleting one that is already gone is not an error.
 * @param {string[]} keys
 */
export async function deleteObjects(keys) {
  if (keys.length === 0) return;
  await getS3Client().send(
    new DeleteObjectsCommand({
      Bucket: mediaConfig().bucket,
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }),
  );
}
