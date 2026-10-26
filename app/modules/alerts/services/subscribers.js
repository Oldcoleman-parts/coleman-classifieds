// Subscribers: double opt-in, unsubscribe and resubscribe. The address is never logged or
// audited (subscriber ids only), and callers never learn whether an address was known.
import { randomUUID } from "node:crypto";
import prisma from "@/db.server";
import { writeAudit } from "@/modules/core/index.js";
import { isSuppressed, send } from "@/modules/notifications/index.js";
import { confirmUrl, unsubscribeUrl } from "./links.js";
import {
  hashToken,
  matches,
  newSubscriberId,
  tokenId,
  unsubscribeToken,
} from "./tokens.js";

const PUBLIC = { type: "SYSTEM", ref: "alerts" };

/** @typedef {"LINK" | "ONE_CLICK" | "SUPPRESSED"} UnsubscribeVia */

/**
 * @param {{ confirmedAt: Date | null, unsubscribedAt: Date | null }} row
 * @returns {boolean} confirmed and not unsubscribed: the only rows that get alert emails
 */
export const isActive = (row) =>
  row.confirmedAt !== null && row.unsubscribedAt === null;

/**
 * Store a new confirm token and email the confirm link.
 * @param {string} id
 * @param {string} email
 * @param {string} base the storefront origin
 */
async function sendConfirm(id, email, base) {
  const { token, url } = confirmUrl(base, id);
  await prisma.alertSubscriber.update({
    where: { id },
    data: { confirmTokenHash: hashToken(token) },
  });
  const { status } = await send(
    "alerts_confirm",
    email,
    { confirm_link: url, unsubscribe_link: unsubscribeUrl(base, id) },
    { idempotencyKey: `alerts_confirm:${id}:${randomUUID()}` },
  );
  if (status !== "SENT")
    console.error(`[alerts] confirm email for ${id} ${status}`);
}

/**
 * Sign an address up (step one of double opt-in). Does the same visible thing whatever the
 * address's state, so the page can't be used to find out who is subscribed.
 * - new or still pending: (re)send the confirm link
 * - unsubscribed: send a confirm link; they stay unsubscribed until they confirm
 * - already active, or suppressed (bounced or complained): nothing
 * @param {string} email cleaned
 * @param {{ base: string, now?: Date }} options
 * @returns {Promise<void>}
 */
export async function subscribe(email, { base, now = new Date() }) {
  if (await isSuppressed(email)) return;
  let row = await prisma.alertSubscriber.findUnique({ where: { email } });
  if (row && isActive(row)) return;
  if (!row) {
    const id = newSubscriberId();
    try {
      row = await prisma.alertSubscriber.create({
        data: {
          id,
          email,
          unsubscribeTokenHash: hashToken(unsubscribeToken(id)),
          createdAt: now,
        },
      });
    } catch (error) {
      // The same address was signed up a moment ago: that request sends the link.
      if (error?.code === "P2002") return;
      throw error;
    }
  } else if (row.confirmedAt === null) {
    // DECISION (F07-T2): a repeat signup restarts the 30-day wait for an unconfirmed row.
    await prisma.alertSubscriber.update({
      where: { id: row.id },
      data: { createdAt: now },
    });
  }
  await writeAudit({
    action: "AlertSubscribeRequested",
    actor: PUBLIC,
    details: { subscriberId: row.id },
  });
  await sendConfirm(row.id, email, base);
}

/**
 * Step two of double opt-in. The confirm token works once.
 * @param {unknown} token
 * @param {{ now?: Date }} [options]
 * @returns {Promise<boolean>} false for an unknown, used or tampered token
 */
export async function confirm(token, { now = new Date() } = {}) {
  const id = tokenId(token);
  if (!id) return false;
  const row = await prisma.alertSubscriber.findUnique({ where: { id } });
  if (!row || !matches(/** @type {string} */ (token), row.confirmTokenHash))
    return false;
  // A bounce or complaint since the link was sent: it can't become active.
  if (await isSuppressed(row.email)) return false;
  const { count } = await prisma.alertSubscriber.updateMany({
    where: { id, confirmTokenHash: row.confirmTokenHash },
    data: { confirmedAt: now, unsubscribedAt: null, confirmTokenHash: null },
  });
  if (count === 0) return false;
  await writeAudit({
    action: "AlertConfirmed",
    actor: PUBLIC,
    details: { subscriberId: id },
  });
  return true;
}

/**
 * The subscriber an unsubscribe token belongs to.
 * @param {unknown} token
 * @returns {Promise<{ id: string, email: string, confirmedAt: Date | null, unsubscribedAt: Date | null } | null>}
 */
export async function findByUnsubscribeToken(token) {
  const id = tokenId(token);
  if (!id) return null;
  const row = await prisma.alertSubscriber.findUnique({ where: { id } });
  if (!row || !matches(/** @type {string} */ (token), row.unsubscribeTokenHash))
    return null;
  return row;
}

/**
 * Stop alert emails for this subscriber. Doing it twice changes nothing. A pending confirm
 * link stops working too.
 * @param {string} id
 * @param {{ via: UnsubscribeVia, now?: Date }} options
 * @returns {Promise<boolean>} true when it was subscribed until now
 */
export async function unsubscribeById(id, { via, now = new Date() }) {
  const { count } = await prisma.alertSubscriber.updateMany({
    where: { id, unsubscribedAt: null },
    data: { unsubscribedAt: now, confirmTokenHash: null },
  });
  if (count === 0) return false;
  await writeAudit({
    action: "AlertUnsubscribed",
    actor: PUBLIC,
    details: { subscriberId: id, via },
  });
  return true;
}

/**
 * Resubscribe from the unsubscribed page: a fresh double opt-in, nothing changes until the
 * new confirm link is used.
 * @param {{ id: string, email: string, unsubscribedAt: Date | null }} row
 * @param {{ base: string }} options
 * @returns {Promise<void>}
 */
export async function resubscribe(row, { base }) {
  if (row.unsubscribedAt === null || (await isSuppressed(row.email))) return;
  await writeAudit({
    action: "AlertSubscribeRequested",
    actor: PUBLIC,
    details: { subscriberId: row.id, resubscribe: true },
  });
  await sendConfirm(row.id, row.email, base);
}
