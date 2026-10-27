// The records purge (F08-T4): one transaction as the `classifieds_purge` role. Ops runs the
// job; each owner deletes its own rows with the `tx` given here. The database trigger only
// lets this role delete an AuditEvent past retention (migration audit_purge_past_retention).
import prisma from "@/db.server";
import { requireId, requireIdList } from "./validators.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Runs `fn(tx)` in one transaction as the purge role. A throw rolls everything back.
 * @template T
 * @param {(tx: import("@prisma/client").Prisma.TransactionClient) => Promise<T>} fn
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<T>}
 */
export function runAsPurgeRole(fn, { timeoutMs = 30_000 } = {}) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE classifieds_purge");
      return fn(tx);
    },
    { timeout: timeoutMs },
  );
}

/**
 * Locks a listing that may be purged now (closed, `purgeAfter` passed, no storefront page)
 * and returns it, or null. Checked again under the lock, so a listing changed since it was
 * picked (a re-issue clearing `purgeAfter`) is left alone.
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {string} listingId
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{ id: string, invitationId: string } | null>}
 */
export async function lockPurgeableListing(
  tx,
  listingId,
  { now = new Date() } = {},
) {
  const rows = await tx.$queryRaw`
    SELECT "id", "invitationId" FROM "Listing"
    WHERE "id" = ${requireId(listingId, "listingId")}
      AND "closedAt" IS NOT NULL AND "purgeAfter" <= ${now}
      AND "metaobjectGid" IS NULL
    FOR UPDATE`;
  return rows[0] ?? null;
}

/**
 * Deletes a listing's audit rows (before the listing: its FK would set them to null).
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {string} listingId
 * @returns {Promise<number>}
 */
export async function purgeListingAudit(tx, listingId) {
  const { count } = await tx.auditEvent.deleteMany({
    where: { listingId: requireId(listingId, "listingId") },
  });
  return count;
}

/**
 * Deletes a listing's time adjustments and the listing itself, after the other owners
 * deleted their rows.
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {string} listingId
 * @returns {Promise<{ adjustments: number, listing: number }>}
 */
export async function purgeListingCore(tx, listingId) {
  const id = requireId(listingId, "listingId");
  const adjustments = await tx.listingTimeAdjustment.deleteMany({
    where: { listingId: id },
  });
  const listing = await tx.listing.deleteMany({ where: { id } });
  return { adjustments: adjustments.count, listing: listing.count };
}

/**
 * Deletes listing-less audit rows past `recordsRetentionDays`, at most `limit` a call.
 * Keeps the `SettingsUpdated` rows of the current rules version and of `keepRulesVersions`
 * (those a kept terms acceptance refers to), so the wording a seller agreed to survives.
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ keepRulesVersions: string[], now?: Date, limit?: number }} options
 * @returns {Promise<number>}
 */
export async function purgeExpiredAuditEntries(
  tx,
  { keepRulesVersions, now = new Date(), limit = 5000 },
) {
  const settings = await tx.settings.findUnique({
    where: { id: 1 },
    select: { recordsRetentionDays: true, rulesVersion: true },
  });
  const days = settings?.recordsRetentionDays ?? 365;
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const keep = [
    ...requireIdList(keepRulesVersions, "keepRulesVersions", {
      max: Infinity,
    }),
    ...(settings?.rulesVersion ? [settings.rulesVersion] : []),
  ];
  return tx.$executeRaw`
    DELETE FROM "AuditEvent" WHERE "id" IN (
      SELECT "id" FROM "AuditEvent"
      WHERE "listingId" IS NULL AND "at" <= ${cutoff}
        AND NOT ("action" = 'SettingsUpdated'
          AND COALESCE("details"->'changes'->'rulesVersion'->>'to', '') = ANY(${keep}::text[]))
      LIMIT ${limit})`;
}
