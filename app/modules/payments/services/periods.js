// The month a fee pays for, kept as a `ListingPeriod` next to the charge.
// DECISION (F06-T2): payments writes it, because only payments knows the charge;
// `ListingWentLive` carries no charge id. The dates are the ones core set when the listing
// went live (`liveAt`, `expiresAt = addMonths(liveAt, 1)`), never computed here.
import prisma from "@/db.server";
import { writeAudit } from "@/modules/core/index.js";

/**
 * Record the period of a fee order that made its listing live. Safe to repeat (one period
 * per charge), and a second fee order for the same listing gets no period of its own.
 * @param {string} listingId
 * @param {string} orderGid
 * @returns {Promise<boolean>} true when a period was created now
 */
export async function ensurePeriod(listingId, orderGid) {
  const [charge, listing] = await Promise.all([
    prisma.feeCharge.findUnique({ where: { orderGid }, select: { id: true } }),
    prisma.listing.findUnique({
      where: { id: listingId },
      select: { liveAt: true, expiresAt: true },
    }),
  ]);
  if (!charge || !listing?.liveAt || !listing.expiresAt) return false;
  const existing = await prisma.listingPeriod.findFirst({
    where: { listingId, startsAt: listing.liveAt },
    select: { id: true },
  });
  if (existing) return false;
  try {
    await prisma.$transaction(async (tx) => {
      const period = await tx.listingPeriod.create({
        data: {
          listingId,
          startsAt: listing.liveAt,
          endsAt: listing.expiresAt,
          chargeId: charge.id,
        },
      });
      await writeAudit(
        {
          action: "ListingPeriodCreated",
          listingId,
          details: { periodId: period.id, chargeId: charge.id },
        },
        { tx },
      );
    });
  } catch (error) {
    // The same delivery, twice at once.
    if (error?.code === "P2002") return false;
    throw error;
  }
  return true;
}
