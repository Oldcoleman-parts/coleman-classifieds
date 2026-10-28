// The records purge (F08-T4): one transaction as the `classifieds_purge` role. Ops runs the
// job; each owner deletes its own rows with the `tx` given here. The database trigger only
// lets this role delete an AuditEvent past retention (migration audit_purge_past_retention).
// DECISION (F08-FIX-7): every age check here uses the database's `now()` (UTC), as the
// trigger does, so an app clock that is off can't pick a row the trigger then refuses.
import prisma from "@/db.server";
import { ValidationError } from "./errors.js";
import { requireId, requireString } from "./validators.js";

/**
 * Rules versions are free text set by core (`v3`, `draft-0`), not ids.
 * @param {unknown} value
 * @returns {string[]}
 */
function requireVersionList(value) {
  if (!Array.isArray(value))
    throw new ValidationError("keepRulesVersions must be a list", {
      keepRulesVersions: "must be a list of versions",
    });
  return [
    ...new Set(
      value.map((version) =>
        requireString(version, "keepRulesVersions", { max: 200 }),
      ),
    ),
  ];
}

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
 * @returns {Promise<{ id: string, invitationId: string } | null>}
 */
export async function lockPurgeableListing(tx, listingId) {
  const rows = await tx.$queryRaw`
    SELECT "id", "invitationId" FROM "Listing"
    WHERE "id" = ${requireId(listingId, "listingId")}
      AND "closedAt" IS NOT NULL AND "purgeAfter" <= (now() AT TIME ZONE 'UTC')
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
 * DECISION (F01-FIX-11): `PrivacyErased` and `privacy.*` rows are kept for good, as the
 * proof that a redaction was done (they hold ids and counts only). The trigger would allow
 * deleting them; the purge chooses not to.
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ keepRulesVersions: string[], limit?: number }} options
 * @returns {Promise<number>}
 */
export async function purgeExpiredAuditEntries(
  tx,
  { keepRulesVersions, limit = 5000 },
) {
  const settings = await tx.settings.findUnique({
    where: { id: 1 },
    select: { rulesVersion: true },
  });
  const keep = [
    ...requireVersionList(keepRulesVersions),
    ...(settings?.rulesVersion ? [settings.rulesVersion] : []),
  ];
  return tx.$executeRaw`
    DELETE FROM "AuditEvent" WHERE "id" IN (
      SELECT "id" FROM "AuditEvent"
      WHERE "listingId" IS NULL
        AND "action" <> 'PrivacyErased' AND "action" NOT LIKE 'privacy.%'
        AND "at" <= (now() AT TIME ZONE 'UTC') - make_interval(days => COALESCE(
          (SELECT "recordsRetentionDays" FROM "Settings" WHERE "id" = 1), 365))
        AND NOT ("action" = 'SettingsUpdated'
          AND COALESCE("details"->'changes'->'rulesVersion'->>'to', '') = ANY(${keep}::text[]))
      LIMIT ${limit})`;
}
