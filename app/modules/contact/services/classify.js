// Which messages are held for staff, from `Settings.heldMessageRules`.
// DECISION (F07-T1): links are looked for in the name and the body; keywords match as
// case-insensitive substrings; "repeat sends" counts the buyer address's earlier messages in
// the last 24 hours, across all listings (blocked attempts aren't stored, so they don't count).
import prisma from "@/db.server";

export const REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;

// A scheme, "www.", or a bare domain followed by a path (e.g. "bit.ly/x").
export const LINK_RE =
  /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/)/i;

/** @param {string} text */
const fold = (text) => text.normalize("NFKC").toLowerCase();

/**
 * Reason codes (`LINK`, `KEYWORD`, `REPEAT`) for holding the message; empty to deliver.
 * The matched keyword itself is never returned, so it can't end up in the audit or an email.
 * @param {{ name: string, body: string }} message
 * @param {{ holdOnLinks: boolean, keywords: string[], repeatThreshold: number }} rules
 * @param {number} priorCount the buyer's earlier messages in the window
 * @returns {string[]}
 */
export function classify({ name, body }, rules, priorCount) {
  const reasons = [];
  const text = fold(`${name}\n${body}`);
  if (rules.holdOnLinks && LINK_RE.test(text)) reasons.push("LINK");
  if (
    rules.keywords.some((word) => {
      const needle = fold(word).trim();
      return needle !== "" && text.includes(needle);
    })
  )
    reasons.push("KEYWORD");
  if (priorCount >= rules.repeatThreshold) reasons.push("REPEAT");
  return reasons;
}

/**
 * @param {string} buyerEmail lowercase
 * @param {Date} now
 * @returns {Promise<number>}
 */
export function countRecent(buyerEmail, now) {
  return prisma.buyerMessage.count({
    where: {
      buyerEmail,
      createdAt: { gte: new Date(now.getTime() - REPEAT_WINDOW_MS) },
      status: { not: "BLOCKED" },
    },
  });
}
