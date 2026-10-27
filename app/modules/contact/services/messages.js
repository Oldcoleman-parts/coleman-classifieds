// Buyer messages: deliver or hold a new one, and the staff release and discard actions.
// The buyer's name, address and words are never logged or audited: IDs and the SES ID only.
import { randomUUID } from "node:crypto";
import prisma from "@/db.server";
import {
  ConflictError,
  dispatch,
  EVENTS,
  getSettings,
  recordEvent,
  requireId,
  requireStaff,
  ValidationError,
  writeAudit,
} from "@/modules/core/index.js";
import { send } from "@/modules/notifications/index.js";
import { classify, countRecent } from "./classify.js";
import { loadRecipient } from "./facts.js";

/**
 * @typedef {import("@/modules/console/services/providers.js").HeldMessage} HeldMessage
 * @typedef {import("@/modules/core/types.js").ActorRef} ActorRef
 */

const BUYER = { type: "BUYER" };
const MAX_HELD_SHOWN = 200;

/**
 * Pass one message on to the seller. ReplyTo is the buyer, so the seller's reply goes
 * straight to them; the seller's address stays inside this call.
 * @param {{ id: string, listingId: string, buyerName: string, buyerEmail: string, body: string }} message
 * @param {string} idempotencyKey
 * @returns {Promise<{ status: string, sesMessageId: string | null }>}
 */
async function relay(message, idempotencyKey) {
  const failed = { status: "FAILED", sesMessageId: null };
  // F08-FIX-8: an erased message has no buyer to reply to, so it is never passed on.
  if (!message.buyerEmail) return failed;
  const recipient = await loadRecipient(message.listingId);
  if (!recipient) return failed;
  let sent;
  try {
    sent = await send(
      "buyer_message",
      recipient.sellerEmail,
      {
        seller_first_name: recipient.sellerFirstName,
        listing_title: recipient.title,
        buyer_name: message.buyerName,
        message: message.body,
      },
      { replyTo: message.buyerEmail, idempotencyKey },
    );
  } catch (error) {
    // DECISION (F08-FIX-8): an address `send()` refuses can never be delivered, so it is
    // a failed send (the buyer's row is removed and they are asked to send again).
    if (error instanceof ValidationError) return failed;
    throw error;
  }
  const { status, sesMessageId } = sent;
  if (status === "SENT")
    console.info(
      `[contact] message ${message.id} delivered ses ${sesMessageId ?? "-"}`,
    );
  return { status, sesMessageId };
}

/**
 * A checked message from the contact form: held for staff, or delivered now.
 * DECISION (F07-T1): `buyer_message` is never queued (the buyer's words aren't stored in the
 * outbox), so when SES fails the message is removed and the buyer is asked to send it again.
 * A suppressed seller address counts as delivered: there is nothing more the buyer can do.
 * @param {{ listingId: string, name: string, email: string, body: string, ip: string }} input
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{ outcome: "DELIVERED" | "HELD" | "FAILED", messageId?: string }>}
 */
export async function submitMessage(input, { now = new Date() } = {}) {
  const { heldMessageRules } = await getSettings();
  const prior = await countRecent(input.email, now);
  const reasons = classify(
    { name: input.name, body: input.body },
    heldMessageRules,
    prior,
  );
  const data = {
    listingId: input.listingId,
    buyerName: input.name,
    buyerEmail: input.email,
    body: input.body,
    ip: input.ip,
    createdAt: now,
  };

  if (reasons.length > 0) {
    const { message, event } = await prisma.$transaction(async (tx) => {
      const message = await tx.buyerMessage.create({
        data: { ...data, status: "HELD", holdReasons: reasons },
        select: { id: true },
      });
      const event = await recordEvent(
        tx,
        EVENTS.BuyerMessageHeld,
        { messageId: message.id, listingId: input.listingId, reasons },
        { actor: BUYER },
      );
      return { message, event };
    });
    // After the commit: notifications emails staff (F01-FIX-4 pattern).
    await dispatch(event);
    return { outcome: "HELD", messageId: message.id };
  }

  const message = await prisma.buyerMessage.create({
    data: { ...data, status: "DELIVERED", holdReasons: [] },
  });
  const { status, sesMessageId } = await relay(
    message,
    `buyer_message:${message.id}`,
  );
  if (status === "FAILED") {
    await prisma.buyerMessage.delete({ where: { id: message.id } });
    return { outcome: "FAILED" };
  }
  await prisma.buyerMessage.update({
    where: { id: message.id },
    data: { sesMessageId },
  });
  await writeAudit({
    action: "BuyerMessageDelivered",
    actor: BUYER,
    listingId: input.listingId,
    details: { messageId: message.id, sesMessageId, outcome: status },
  });
  return { outcome: "DELIVERED", messageId: message.id };
}

/**
 * Held messages waiting for staff, oldest first.
 * @returns {Promise<HeldMessage[]>}
 */
export async function listHeld() {
  const rows = await prisma.buyerMessage.findMany({
    where: { status: "HELD" },
    orderBy: { createdAt: "asc" },
    take: MAX_HELD_SHOWN,
    select: {
      id: true,
      listingId: true,
      buyerName: true,
      buyerEmail: true,
      body: true,
      holdReasons: true,
      createdAt: true,
      listing: { select: { title: true } },
    },
  });
  return rows.map(({ listing, ...row }) => ({
    ...row,
    listingTitle: listing?.title ?? null,
  }));
}

/**
 * Send a held message to the seller, exactly once. The HELD → RELEASED claim is one
 * conditional update, so a second click or a second staff member gets `changed: false` and
 * sends nothing. When SES fails the claim is undone and the message stays held.
 * DECISION (F07-T1): a crash between the claim and the send leaves it RELEASED and unsent;
 * `reviewedAt` records the claim, and staff can ask the buyer to write again.
 * @param {unknown} id
 * @param {ActorRef} staff
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{ changed: boolean, listingId: string | null }>}
 * @throws {ConflictError} when the email couldn't be sent
 */
export async function release(id, staff, { now = new Date() } = {}) {
  const who = requireStaff(staff);
  const messageId = requireId(id, "messageId");
  const claimAt = now;
  const { count } = await prisma.buyerMessage.updateMany({
    where: { id: messageId, status: "HELD" },
    data: { status: "RELEASED", reviewedBy: who.ref, reviewedAt: claimAt },
  });
  const message = await prisma.buyerMessage.findUnique({
    where: { id: messageId },
  });
  if (count === 0 || !message)
    return { changed: false, listingId: message?.listingId ?? null };

  // The key belongs to this claim: a send that failed and was undone can be tried again.
  const { status, sesMessageId } = await relay(
    message,
    `buyer_message:${messageId}:release:${randomUUID()}`,
  );
  if (status === "FAILED") {
    await prisma.buyerMessage.updateMany({
      where: { id: messageId, status: "RELEASED", reviewedAt: claimAt },
      data: { status: "HELD", reviewedBy: null, reviewedAt: null },
    });
    throw new ConflictError(
      "The message couldn’t be sent. Please try again in a few minutes.",
    );
  }
  await prisma.buyerMessage.update({
    where: { id: messageId },
    data: { sesMessageId },
  });
  return { changed: true, listingId: message.listingId };
}

/**
 * Drop a held message; it is never sent.
 * @param {unknown} id
 * @param {ActorRef} staff
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{ changed: boolean, listingId: string | null }>}
 */
export async function discard(id, staff, { now = new Date() } = {}) {
  const who = requireStaff(staff);
  const messageId = requireId(id, "messageId");
  const { count } = await prisma.buyerMessage.updateMany({
    where: { id: messageId, status: "HELD" },
    data: { status: "DISCARDED", reviewedBy: who.ref, reviewedAt: now },
  });
  const message = await prisma.buyerMessage.findUnique({
    where: { id: messageId },
    select: { listingId: true },
  });
  return { changed: count === 1, listingId: message?.listingId ?? null };
}
