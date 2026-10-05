// The Settings singleton (row id 1). Created with the documented defaults on first read.
import prisma from "@/db.server";

/** @typedef {import("./types.js").Settings} Settings */

// The three columns without a database default. Staff replace the rules text before launch.
const INITIAL = {
  id: 1,
  heldMessageRules: { holdOnLinks: true, keywords: [], repeatThreshold: 3 },
  rulesVersion: "draft-0",
  rulesText: "Listing rules have not been published yet.",
};

/**
 * @param {{ tx?: import("@prisma/client").Prisma.TransactionClient }} [options]
 * @returns {Promise<Settings>}
 */
export async function getSettings({ tx } = {}) {
  const db = tx ?? prisma;
  const existing = await db.settings.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  // Two first reads can race; the loser's insert is skipped and both read the same row.
  await db.settings.createMany({ data: [INITIAL], skipDuplicates: true });
  return db.settings.findUniqueOrThrow({ where: { id: 1 } });
}
