// What contact needs to know about a listing.
// DECISION (F07-T1): read-only selects of `Listing` and `Invitation` kept in this one file,
// as in payments and publishing. Core has no lookup by storefront handle; follow-up: a core
// export for these facts. Contact never writes either table.
import prisma from "@/db.server";

const HANDLE_RE = /^[a-z0-9-]{1,120}$/;

/**
 * A listing that accepts messages right now: LIVE and not yet expired.
 * @param {unknown} handle the metaobject handle from the address
 * @param {Date} now
 * @returns {Promise<{ id: string, title: string } | null>}
 */
export async function findOpenListingByHandle(handle, now) {
  if (typeof handle !== "string" || !HANDLE_RE.test(handle)) return null;
  const listing = await prisma.listing.findFirst({
    where: { metaobjectHandle: handle },
    select: { id: true, title: true, status: true, expiresAt: true },
  });
  if (!listing || !isOpen(listing, now)) return null;
  return { id: listing.id, title: listing.title ?? "" };
}

/**
 * @param {{ status: string, expiresAt: Date | null }} listing
 * @param {Date} now
 */
const isOpen = (listing, now) =>
  listing.status === "LIVE" &&
  listing.expiresAt !== null &&
  listing.expiresAt > now;

/**
 * Who a message goes to. The only place the seller's address is read; it is used for the
 * send and never put in a page, a log or an audit entry.
 * @param {string} listingId
 * @returns {Promise<{ sellerEmail: string, sellerFirstName: string, title: string } | null>}
 */
export async function loadRecipient(listingId) {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      title: true,
      invitation: { select: { sellerEmail: true, sellerName: true } },
    },
  });
  if (!listing) return null;
  return {
    sellerEmail: listing.invitation.sellerEmail,
    sellerFirstName: listing.invitation.sellerName.trim().split(/\s+/)[0] ?? "",
    title: listing.title ?? "",
  };
}
