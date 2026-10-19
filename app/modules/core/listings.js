// Read-only views of a listing for other modules. Status changes stay in lifecycle.js.
import prisma from "@/db.server";
import { EVENTS } from "./events.js";

/**
 * The few listing facts another module may show to staff (for example in a staff notice).
 * @param {string} id
 * @returns {Promise<{ id: string, title: string | null, status: string, closedAt: Date | null } | null>}
 *   null when there is no such listing; `closedAt` is set once the listing has closed
 */
export async function getListingSummary(id) {
  if (typeof id !== "string" || id === "") return null;
  return prisma.listing.findUnique({
    where: { id },
    select: { id: true, title: true, status: true, closedAt: true },
  });
}

/**
 * The latest staff change-request note of a listing, for the seller page. It is kept in the
 * `ChangesRequested` audit entry (F01-FIX-6).
 * @param {string} listingId
 * @returns {Promise<{ note: string, at: Date } | null>} null when there is none (or it was purged)
 */
export async function getChangesRequestNote(listingId) {
  if (typeof listingId !== "string" || listingId === "") return null;
  const entry = await prisma.auditEvent.findFirst({
    where: { listingId, action: EVENTS.ChangesRequested },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    select: { details: true, at: true },
  });
  const note = entry?.details?.note;
  return typeof note === "string" ? { note, at: entry.at } : null;
}
