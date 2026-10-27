// The records purge (F08-T4): a listing's revisions and terms acceptances, inside the purge
// transaction ops runs.
import prisma from "@/db.server";
import { requireId } from "@/modules/core/index.js";

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {string} listingId
 * @returns {Promise<{ revisions: number, terms: number }>}
 */
export async function purgeListingWorkspace(tx, listingId) {
  const id = requireId(listingId, "listingId");
  const revisions = await tx.listingRevision.deleteMany({
    where: { listingId: id },
  });
  const terms = await tx.termsAcceptance.deleteMany({
    where: { listingId: id },
  });
  return { revisions: revisions.count, terms: terms.count };
}

/**
 * Every rules version a kept terms acceptance refers to: their wording must stay in the
 * audit log.
 * @returns {Promise<string[]>}
 */
export async function referencedRulesVersions() {
  const rows = await prisma.termsAcceptance.findMany({
    distinct: ["rulesVersion"],
    select: { rulesVersion: true },
  });
  return rows.map(({ rulesVersion }) => rulesVersion);
}
