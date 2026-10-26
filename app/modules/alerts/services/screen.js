// Settings → Alerts: subscriber counts and the CSV export of active subscribers.
import prisma from "@/db.server";
import { isEnabled, requireStaff, writeAudit } from "@/modules/core/index.js";

/** @typedef {import("@/modules/core/types.js").ActorRef} ActorRef */

const BATCH = 500;
const BOM = String.fromCharCode(0xfeff);
const COLUMNS = ["email", "confirmed_at"];
// A cell starting with one of these is treated as a formula by Excel and Sheets.
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * DECISION (F07-T2): a copy of console's CSV cell (not exported from its index.js).
 * @param {unknown} value
 * @returns {string} one quoted, injection-safe cell
 */
export function csvCell(value) {
  let text = value instanceof Date ? value.toISOString() : String(value ?? "");
  if (FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/** @param {unknown[]} values */
const csvRow = (values) => `${values.map(csvCell).join(",")}\r\n`;

const ACTIVE = { confirmedAt: { not: null }, unsubscribedAt: null };

/**
 * @returns {Promise<{ enabled: boolean, counts: { active: number, pending: number, unsubscribed: number, queued: number } }>}
 */
export async function loadAlertsScreen() {
  const [enabled, active, pending, unsubscribed, queued] = await Promise.all([
    isEnabled("alerts"),
    prisma.alertSubscriber.count({ where: ACTIVE }),
    prisma.alertSubscriber.count({
      where: { confirmedAt: null, unsubscribedAt: null },
    }),
    prisma.alertSubscriber.count({ where: { unsubscribedAt: { not: null } } }),
    prisma.alertQueue.count({ where: { sentAt: null } }),
  ]);
  return { enabled, counts: { active, pending, unsubscribed, queued } };
}

/**
 * The active subscribers as CSV. DECISION (F07-T2): active only (email, confirmed_at).
 * Audited with the staff email before anything is read.
 * @param {ActorRef} actor
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{ filename: string, stream: ReadableStream<Uint8Array> }>}
 */
export async function streamSubscribersCsv(actor, { now = new Date() } = {}) {
  const staff = requireStaff(actor);
  const total = await prisma.alertSubscriber.count({ where: ACTIVE });
  await writeAudit({
    action: "AlertSubscribersExported",
    actor: staff,
    details: { rows: total },
  });

  const encoder = new TextEncoder();
  /** @type {string | null} */
  let after = null;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(BOM + csvRow(COLUMNS)));
    },
    async pull(controller) {
      const rows = await prisma.alertSubscriber.findMany({
        where: ACTIVE,
        orderBy: { id: "asc" },
        take: BATCH,
        ...(after ? { cursor: { id: after }, skip: 1 } : {}),
        select: { id: true, email: true, confirmedAt: true },
      });
      if (rows.length === 0) {
        controller.close();
        return;
      }
      after = rows[rows.length - 1].id;
      controller.enqueue(
        encoder.encode(
          rows.map((row) => csvRow([row.email, row.confirmedAt])).join(""),
        ),
      );
    },
  });
  const day = now.toISOString().slice(0, 10);
  return { filename: `alert-subscribers-${day}.csv`, stream };
}
