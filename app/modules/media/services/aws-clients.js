// The one place that talks to Amazon S3 and CloudFront. Clients are created on first use, so
// the app starts (and tests run) without any AWS settings; tests swap in stand-ins.
import { CloudFrontClient } from "@aws-sdk/client-cloudfront";
import { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** @typedef {{ send: (command: any) => Promise<any> }} AwsClient */

/** @type {AwsClient | null} */
let s3 = null;
/** @type {AwsClient | null} */
let cloudFront = null;
/** @type {((command: any, options: object) => Promise<string>) | null} */
let presigner = null;

/** Photo storage can't be used until the bucket and CloudFront settings are set. */
export class MediaNotConfiguredError extends Error {
  constructor() {
    super("Photo storage is not configured");
    this.name = "MediaNotConfigured";
  }
}

/**
 * @returns {{ bucket: string, domain: string, distributionId: string }}
 * @throws {MediaNotConfiguredError}
 */
export function mediaConfig() {
  const bucket = process.env.S3_BUCKET;
  const domain = process.env.CLOUDFRONT_DOMAIN;
  const distributionId = process.env.CLOUDFRONT_DISTRIBUTION_ID;
  if (!bucket || !domain || !distributionId)
    throw new MediaNotConfiguredError();
  return { bucket, domain, distributionId };
}

/** @returns {AwsClient} */
export function getS3Client() {
  // Credentials come from the standard AWS environment variables or the host's role.
  // Checksums are added only when S3 requires them: an upload link is signed before the
  // file exists, so a checksum worked out here would never match the browser's upload.
  s3 ??= new S3Client({
    region: process.env.AWS_REGION,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return s3;
}

/**
 * Replace the S3 client (tests), or pass null to go back to the real one.
 * @param {AwsClient | null} replacement
 */
export function setS3Client(replacement) {
  s3 = replacement;
}

/** @returns {AwsClient} */
export function getCloudFrontClient() {
  cloudFront ??= new CloudFrontClient({ region: process.env.AWS_REGION });
  return cloudFront;
}

/**
 * Replace the CloudFront client (tests), or pass null to go back to the real one.
 * @param {AwsClient | null} replacement
 */
export function setCloudFrontClient(replacement) {
  cloudFront = replacement;
}

/**
 * Replace the link signer (tests), or pass null to go back to the real one.
 * @param {((command: any, options: object) => Promise<string>) | null} replacement
 */
export function setPresigner(replacement) {
  presigner = replacement;
}

/**
 * A time-limited link for one S3 command.
 * @param {any} command
 * @param {{ expiresIn: number, signableHeaders?: Set<string> }} options
 * @returns {Promise<string>}
 */
export function presign(command, options) {
  return presigner
    ? presigner(command, options)
    : getSignedUrl(/** @type {any} */ (getS3Client()), command, options);
}
