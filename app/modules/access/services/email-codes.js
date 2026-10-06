// The email sign-in code a seller enters on a new device (when Settings ask for one).
// Codes are 6 digits, last 15 minutes, are stored only as a hash and are never logged.
import { randomInt } from "node:crypto";
import prisma from "@/db.server";
import { writeAudit } from "@/modules/core/index.js";
import { send } from "@/modules/notifications/index.js";
import { issueDeviceCredential } from "./device.js";
import { hit } from "./rate-limit.js";
import { hashSecret, safeEqualHex } from "./tokens.js";

export const CODE_MINUTES = 15;
export const MAX_ATTEMPTS = 5;
const MINUTE_MS = 60 * 1000;
// DECISION: 5 wrong codes within an hour lock the invitation for the rest of that hour
// (worked out from the EmailCode rows: no schema change).
const LOCK_WINDOW_MS = 60 * MINUTE_MS;

const codeHash = (code, invitationId) => hashSecret(`${code}:${invitationId}`);
const sellerActor = (invitationId) => ({ type: "SELLER", ref: invitationId });

/** Codes issued within the lock window: `issuedAt` is `expiresAt − 15 min`. */
const recentCodes = (invitationId, now) => ({
  invitationId,
  usedAt: null,
  expiresAt: {
    gt: new Date(now.getTime() - LOCK_WINDOW_MS + CODE_MINUTES * MINUTE_MS),
  },
});

/**
 * @param {string} invitationId
 * @param {Date} now
 * @returns {Promise<boolean>}
 */
export async function isLocked(invitationId, now) {
  const { _sum } = await prisma.emailCode.aggregate({
    where: recentCodes(invitationId, now),
    _sum: { attempts: true },
  });
  return (_sum.attempts ?? 0) >= MAX_ATTEMPTS;
}

/**
 * Email a new code to the seller.
 * @param {{ id: string, sellerName: string, sellerEmail: string }} invitation a resolved one
 * @param {{ ip?: string, now?: Date }} [options]
 * @returns {Promise<{ state: "SENT" | "RATE_LIMITED" | "LOCKED" | "SEND_FAILED" }>}
 */
export async function requestEmailCode(
  invitation,
  { ip = "unknown", now = new Date() } = {},
) {
  const at = now.getTime();
  const perInvitation = hit(`code-request:inv:${invitation.id}`, {
    limit: 3,
    windowMs: 15 * MINUTE_MS,
    now: at,
  });
  const perIp = hit(`code-request:ip:${ip}`, {
    limit: 10,
    windowMs: 60 * MINUTE_MS,
    now: at,
  });
  if (!perInvitation || !perIp) return { state: "RATE_LIMITED" };
  if (await isLocked(invitation.id, now)) return { state: "LOCKED" };

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const row = await prisma.emailCode.create({
    data: {
      invitationId: invitation.id,
      codeHash: codeHash(code, invitation.id),
      expiresAt: new Date(at + CODE_MINUTES * MINUTE_MS),
    },
  });
  let status;
  try {
    ({ status } = await send(
      "email_code",
      invitation.sellerEmail,
      {
        seller_first_name: invitation.sellerName.split(/\s+/)[0],
        code,
        code_minutes: CODE_MINUTES,
      },
      { now },
    ));
  } catch (error) {
    console.error(`[access] code email failed: ${error?.name ?? "Error"}`);
    status = "FAILED";
  }
  if (status === "FAILED") {
    // A code that never arrived must not be usable.
    await prisma.emailCode.update({
      where: { id: row.id },
      data: { expiresAt: now },
    });
    return { state: "SEND_FAILED" };
  }
  return { state: "SENT" };
}

/**
 * Check a code. Each try counts before the comparison, so parallel guesses can't skip the limit.
 * @param {{ id: string }} invitation a resolved one
 * @param {unknown} code
 * @param {{ ip?: string, now?: Date }} [options]
 * @returns {Promise<{ state: "OK", device: string }
 *   | { state: "WRONG", attemptsLeft: number }
 *   | { state: "LOCKED" | "NO_CODE" | "RATE_LIMITED" }>}
 */
export async function verifyEmailCode(
  invitation,
  code,
  { ip = "unknown", now = new Date() } = {},
) {
  if (
    !hit(`code-verify:ip:${ip}`, {
      limit: 20,
      windowMs: 15 * MINUTE_MS,
      now: now.getTime(),
    })
  )
    return { state: "RATE_LIMITED" };
  if (await isLocked(invitation.id, now)) return { state: "LOCKED" };
  const latest = await prisma.emailCode.findFirst({
    where: {
      invitationId: invitation.id,
      usedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { expiresAt: "desc" },
  });
  if (!latest) return { state: "NO_CODE" };

  const { count } = await prisma.emailCode.updateMany({
    where: { id: latest.id, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (count === 0) return { state: "LOCKED" };

  const given = typeof code === "string" ? code.trim() : "";
  const matches =
    /^\d{6}$/.test(given) &&
    safeEqualHex(latest.codeHash, codeHash(given, invitation.id));
  if (matches) {
    const { count: used } = await prisma.emailCode.updateMany({
      where: { id: latest.id, usedAt: null },
      data: { usedAt: now },
    });
    if (used === 0) return { state: "NO_CODE" };
    await writeAudit({
      action: "SellerVerified",
      actor: sellerActor(invitation.id),
      details: { invitationId: invitation.id },
    });
    return {
      state: "OK",
      device: issueDeviceCredential(invitation.id, { now }),
    };
  }

  if (await isLocked(invitation.id, now)) {
    await writeAudit({
      action: "EmailCodeLocked",
      actor: sellerActor(invitation.id),
      details: { invitationId: invitation.id },
    });
    return { state: "LOCKED" };
  }
  const { _sum } = await prisma.emailCode.aggregate({
    where: recentCodes(invitation.id, now),
    _sum: { attempts: true },
  });
  return { state: "WRONG", attemptsLeft: MAX_ATTEMPTS - (_sum.attempts ?? 0) };
}
