// The bearer secret check for /jobs/run.
import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value) => createHash("sha256").update(value).digest();

/**
 * @param {Request} request
 * @returns {boolean} true only for `Authorization: Bearer <JOBS_SECRET>`
 */
export function isAuthorizedJobRequest(request) {
  const secret = process.env.JOBS_SECRET;
  // Fail closed: without a configured secret nobody may run jobs.
  if (!secret) return false;
  const match = /^Bearer (.+)$/.exec(
    request.headers.get("authorization") ?? "",
  );
  if (!match) return false;
  // Hashing first gives equal-length buffers, so the comparison is constant-time.
  return timingSafeEqual(digest(match[1]), digest(secret));
}
