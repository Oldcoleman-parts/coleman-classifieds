// Shared setup for console tests.
import { expect } from "vitest";
import { prisma, resetDb } from "@/../tests/db.js";
import {
  asStaff,
  mockCloudFront,
  mockS3,
  mockSes,
} from "@/../tests/factories.js";
// Test-only: core keeps the action list cached; each test seeds its own rows.
import { clearAuditActionCache } from "@/modules/core/audit.js";
import { setCloudFrontClient, setS3Client } from "@/modules/media/index.js";
import { setSesClient } from "@/modules/notifications/index.js";

export const STAFF = asStaff();
export const staffActor = { type: "STAFF", ref: STAFF.session.email };

/**
 * Reset DB and put stand-ins in place of SES, S3 and CloudFront, so no test reaches AWS.
 * A test that checks sent email installs its own `mockSes()` after this.
 */
export async function setUp() {
  await resetDb();
  clearAuditActionCache();
  setSesClient(mockSes());
  setS3Client(mockS3());
  setCloudFrontClient(mockCloudFront());
  process.env.SES_FROM_TRANSACTIONAL = "tx@example.test";
  process.env.SES_CONFIG_SET_TRANSACTIONAL = "tx-config";
}

/**
 * The audit entry of one action on a listing must name the staff member who did it.
 * @param {string} listingId
 * @param {string} action the audit action, for example "ListingRejected"
 */
export async function expectAuditedByStaff(listingId, action) {
  const audits = await prisma.auditEvent.findMany({
    where: { listingId, action },
  });
  expect(audits).toHaveLength(1);
  expect(audits[0].actor).toBe("STAFF");
  expect(audits[0].actorRef).toBe(STAFF.session.email);
}

export function tearDown() {
  setSesClient(null);
  setS3Client(null);
  setCloudFrontClient(null);
  delete process.env.SES_FROM_TRANSACTIONAL;
  delete process.env.SES_CONFIG_SET_TRANSACTIONAL;
}

export { prisma };
