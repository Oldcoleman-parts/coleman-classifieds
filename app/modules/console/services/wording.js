// Staff fix the wording (title and description) of a listing under review.
import prisma from "@/db.server";
import {
  ConflictError,
  requireStaff,
  ValidationError,
  writeAudit,
} from "@/modules/core/index.js";

// DECISION (F05-T1): the same rules as the seller form (workspace `services/fields.js`), copied
// until workspace exports a text cleaner (follow-up FU1).
const LIMITS = {
  title: { min: 5, max: 120 },
  description: { min: 20, max: 5000 },
};
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/**
 * @param {unknown} value
 * @param {"title" | "description"} field
 * @returns {string}
 */
function cleanText(value, field) {
  const fail = (problem) => {
    throw new ValidationError(`${field} ${problem}`, { [field]: problem });
  };
  if (typeof value !== "string") fail("is required");
  let clean = value.replace(/\r\n?/g, "\n").replace(CONTROL_CHARS_RE, "");
  if (field === "title") clean = clean.replace(/\s+/g, " ");
  clean = clean.trim();
  const { min, max } = LIMITS[field];
  if (clean.length < min) fail(`must be at least ${min} characters`);
  if (clean.length > max) fail(`must be at most ${max} characters`);
  if (/[<>]/.test(clean)) fail("can’t contain < or >");
  return clean;
}

/**
 * Save staff's wording. Only while the listing is SUBMITTED (being reviewed), so it never
 * changes a live listing behind the revision process. Audited with the field names only.
 * @param {string} listingId
 * @param {{ title: unknown, description: unknown }} input
 * @param {import("@/modules/core/types.js").ActorRef} actor
 * @returns {Promise<{ changed: string[] }>}
 * @throws {ValidationError | ConflictError}
 */
export async function saveStaffWording(listingId, input, actor) {
  const staff = requireStaff(actor);
  const title = cleanText(input.title, "title");
  const description = cleanText(input.description, "description");

  return prisma.$transaction(async (tx) => {
    const current = await tx.listing.findUnique({
      where: { id: listingId },
      select: { title: true, description: true },
    });
    const changed = [];
    if (current?.title !== title) changed.push("title");
    if (current?.description !== description) changed.push("description");

    const { count } = await tx.listing.updateMany({
      where: { id: listingId, status: "SUBMITTED" },
      data: { title, description },
    });
    if (count === 0)
      throw new ConflictError("The wording can only be edited during review");
    if (changed.length > 0)
      await writeAudit(
        {
          action: "StaffWordingEdited",
          actor: staff,
          listingId,
          details: { fields: changed },
        },
        { tx },
      );
    return { changed };
  });
}
