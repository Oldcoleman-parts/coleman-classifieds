// Read-only views of a listing for other modules. Status changes stay in lifecycle.js.
import prisma from "@/db.server";

/**
 * The few listing facts another module may show to staff (for example in a staff notice).
 * @param {string} id
 * @returns {Promise<{ id: string, title: string | null, status: string } | null>} null when
 *   there is no such listing
 */
export async function getListingSummary(id) {
  if (typeof id !== "string" || id === "") return null;
  return prisma.listing.findUnique({
    where: { id },
    select: { id: true, title: true, status: true },
  });
}
