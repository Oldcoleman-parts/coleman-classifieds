// What an alert email needs to know about a listing.
// DECISION (F07-T2): a read-only select of `Listing` kept in this one file, as in contact,
// payments and publishing. Only public fields are read: never the seller or the invitation.
import prisma from "@/db.server";

/**
 * @typedef {object} ListingFacts
 * @property {string} id
 * @property {string} title
 * @property {number | null} askingPriceCents
 * @property {string} city
 * @property {string} state
 * @property {string} handle
 */

/**
 * Whether a listing can be announced now.
 * - `open`: LIVE, not expired, with its storefront page.
 * - `waiting`: LIVE and not expired, but publishing hasn't created its page yet.
 * - `gone`: anything else (closed, expired, removed).
 * DECISION (F07-T2): a `waiting` listing is retried by the hourly sweep until it is stale.
 * @param {string} id
 * @param {Date} now
 * @returns {Promise<{ state: "open" | "waiting" | "gone", facts?: ListingFacts }>}
 */
export async function listingState(id, now) {
  const row = await prisma.listing.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      title: true,
      askingPriceCents: true,
      city: true,
      state: true,
      metaobjectHandle: true,
    },
  });
  if (!row || row.status !== "LIVE" || !row.expiresAt || row.expiresAt <= now)
    return { state: "gone" };
  if (!row.metaobjectHandle) return { state: "waiting" };
  return {
    state: "open",
    facts: {
      id: row.id,
      title: row.title ?? "",
      askingPriceCents: row.askingPriceCents,
      city: row.city ?? "",
      state: row.state ?? "",
      handle: row.metaobjectHandle,
    },
  };
}
