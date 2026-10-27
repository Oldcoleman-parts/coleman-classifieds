// The send queue. Every email gets an EmailOutbox row, is tried straight away, and is
// retried by the hourly task when SES is unavailable. Logs carry the row id, the template
// key and an error code only: never an address, a subject or the email's data.
import { Prisma } from "@prisma/client";
import prisma from "@/db.server";
import { requireEmail, ValidationError } from "@/modules/core/index.js";
import { templateDef } from "../registry.js";
import { getEmailSettings } from "./email-settings.js";
import { reportEmailProblem } from "./problems.js";
import { cleanVars, renderEmail } from "./render.js";
import { buildSendCommand, getSesClient } from "./ses-client.js";
import { isSuppressed } from "./suppression.js";
import { getTemplate } from "./templates.js";

const MINUTE = 60_000;
// The wait after each failed try. The task runs hourly, so short waits mean "the next run".
const BACKOFF_MS = [5, 30, 120, 360, 1440].map((minutes) => minutes * MINUTE);
const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
// An email that can't be stored is retried on the spot instead.
const IMMEDIATE_TRIES = 3;
const STUCK_AFTER_MS = 15 * MINUTE;
const KEEP_FINISHED_MS = 30 * 24 * 60 * MINUTE;
const BATCH = 50;
const FINISHED = ["SENT", "FAILED", "DEAD", "SUPPRESSED"];
// SES answers that will not change on a retry.
const PERMANENT = [
  "MessageRejected",
  "BadRequestException",
  "NotFoundException",
  "MailFromDomainNotVerifiedException",
  "AccountSuspendedException",
  "SendingPausedException",
  // The template or its data can't be rendered.
  "ValidationError",
  "ParseError",
  "RenderError",
  "UndefinedVariableError",
];
// DECISION: the spec gives no thresholds. These are the levels at which SES starts
// reviewing an account, measured over a day once enough email has gone out to mean anything.
const MIN_SENT_FOR_RATES = 20;
const MAX_BOUNCE_RATE = 0.05;
const MAX_COMPLAINT_RATE = 0.001;

/** @typedef {"SENT" | "PENDING" | "FAILED" | "DEAD" | "SUPPRESSED" | "SENDING"} OutboxStatus */

/** @param {unknown} error */
const errorCode = (error) =>
  String(/** @type {{ name?: string }} */ (error)?.name ?? "Error")
    .replace(/[^A-Za-z0-9_]/g, "")
    .slice(0, 60) || "Error";

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string} a lower-cased address that is safe to put in a header
 */
function address(value, field) {
  const email = requireEmail(value, field);
  if (/[<>,;:"()\\]/.test(email))
    throw new ValidationError(`${field} is not valid`, {
      [field]: "must be a valid email address",
    });
  return email;
}

/**
 * Try one outbox row once and record the result.
 * @param {import("@prisma/client").EmailOutbox} row claimed (status SENDING)
 * @param {Record<string, unknown>} vars
 * @param {{ now: Date, retryLater: boolean, quiet?: boolean }} options `retryLater` is false
 *   for emails whose data isn't stored; `quiet` leaves reporting a failure to the caller
 * @returns {Promise<OutboxStatus>}
 */
async function attempt(row, vars, { now, retryLater, quiet = false }) {
  const attempts = row.attempts + 1;
  /** @param {OutboxStatus} status @param {object} [data] */
  // updateMany: a privacy erase may have deleted the row meanwhile (F08-FIX-8).
  const finish = async (status, data = {}) => {
    await prisma.emailOutbox.updateMany({
      where: { id: row.id },
      data: { status, attempts, ...data },
    });
    return status;
  };

  if (await isSuppressed(row.toAddress))
    return finish("SUPPRESSED", { vars: Prisma.DbNull });

  let code;
  let permanent = false;
  try {
    const def = templateDef(row.templateKey);
    const [template, settings] = await Promise.all([
      getTemplate(row.templateKey),
      getEmailSettings(),
    ]);
    // Alert emails must carry the postal address; without one nothing is sent.
    if (def.stream === "alerts" && !settings.postalAddress?.trim()) {
      code = "NoPostalAddress";
    } else {
      const email = await renderEmail(
        row.templateKey,
        template,
        vars,
        settings,
      );
      const command = buildSendCommand({
        ...email,
        stream: def.stream,
        to: row.toAddress,
        replyTo: row.replyTo ?? settings.replyTo,
        senderName: settings.senderName,
        unsubscribeLink:
          def.stream === "alerts" ? String(vars.unsubscribe_link) : null,
      });
      const result = await getSesClient().send(command);
      return finish("SENT", {
        sentAt: now,
        sesMessageId: result?.MessageId ?? null,
        lastErrorCode: null,
        vars: Prisma.DbNull,
      });
    }
  } catch (error) {
    code = errorCode(error);
    permanent = PERMANENT.includes(code);
  }

  console.error(`[email] outbox ${row.id} ${row.templateKey} ${code}`);
  const canRetry = retryLater && !permanent && attempts < MAX_ATTEMPTS;
  if (canRetry)
    return finish("PENDING", {
      lastErrorCode: code,
      nextAttemptAt: new Date(now.getTime() + BACKOFF_MS[attempts - 1]),
    });
  const status = retryLater && !permanent ? "DEAD" : "FAILED";
  if (!quiet) await reportFailure(row, status, code, now);
  return finish(status, { lastErrorCode: code, vars: Prisma.DbNull });
}

/**
 * @param {{ id: string, templateKey: string }} row
 * @param {string} status
 * @param {string | null} code
 * @param {Date} now
 */
function reportFailure(row, status, code, now) {
  return reportEmailProblem(
    `email-${status.toLowerCase()}:${row.templateKey}`,
    "An email could not be sent.",
    { templateKey: row.templateKey, outboxId: row.id, code: code ?? "Error" },
    { now },
  );
}

/**
 * An idempotency key as the status reads accept it: a non-empty string of at most 200
 * characters, compared exactly (not trimmed).
 * @param {unknown} key
 * @returns {key is string}
 */
function isValidKey(key) {
  return typeof key === "string" && key !== "" && key.length <= 200;
}

/**
 * The status of the email sent with this idempotency key, for staff screens (F04-FIX-3).
 * Returns the status and its time only: never the address, the data or the body.
 * Finished rows are removed after 30 days, so an old key returns null.
 * @param {string} idempotencyKey
 * @returns {Promise<{ status: OutboxStatus, at: Date } | null>}
 */
export async function getEmailStatus(idempotencyKey) {
  if (!isValidKey(idempotencyKey)) return null;
  const row = await prisma.emailOutbox.findUnique({
    where: { idempotencyKey },
    select: { status: true, sentAt: true, createdAt: true },
  });
  if (!row) return null;
  return {
    status: /** @type {OutboxStatus} */ (row.status),
    at: row.sentAt ?? row.createdAt,
  };
}

/** At most this many keys in one `getEmailStatuses()` call. */
const MAX_STATUS_KEYS = 1000;

/**
 * The status of the emails sent with these idempotency keys, in one query, for batches
 * (F03-FIX-5: ops' reminder and closed-email tasks). The status only: never the address,
 * the data or the message id. Keys with no row are left out; finished rows are removed
 * after 30 days, so an old key is left out too, as if it was never sent.
 * DECISION (F03-FIX-5): an invalid key throws here, unlike `getEmailStatus()` (null), because
 * a batch caller builds its keys itself and a bad one is a bug.
 * @param {string[]} keys up to 1000; duplicates are dropped
 * @returns {Promise<Map<string, OutboxStatus>>}
 * @throws {ValidationError} for more than 1000 keys or a key that isn't a non-empty string
 *   of at most 200 characters
 */
export async function getEmailStatuses(keys) {
  if (!Array.isArray(keys))
    throw new ValidationError("Keys must be a list", {
      keys: "must be a list",
    });
  const unique = [...new Set(keys)];
  if (unique.length > MAX_STATUS_KEYS)
    throw new ValidationError("Too many keys", {
      keys: `must have at most ${MAX_STATUS_KEYS} items`,
    });
  if (!unique.every(isValidKey))
    throw new ValidationError("Invalid key", {
      keys: "must be non-empty strings of at most 200 characters",
    });
  if (unique.length === 0) return new Map();
  const rows = await prisma.emailOutbox.findMany({
    where: { idempotencyKey: { in: unique } },
    select: { idempotencyKey: true, status: true },
  });
  return new Map(
    rows.map((row) => [
      /** @type {string} */ (row.idempotencyKey),
      /** @type {OutboxStatus} */ (row.status),
    ]),
  );
}

/**
 * Send one email from a template. The address is checked against the suppression list
 * first. If SES is unavailable the email is queued and retried, except for emails that
 * carry a code or private link: their data is never stored, so they are retried on the
 * spot and the caller gets `FAILED` if that doesn't work.
 * @param {string} key a template key from the registry
 * @param {string} to
 * @param {Record<string, unknown>} vars the template's placeholders
 * @param {{ replyTo?: string, idempotencyKey?: string, now?: Date }} [options] a second
 *   send with the same `idempotencyKey` does nothing and returns the first one's status
 * @returns {Promise<{ status: OutboxStatus, outboxId: string, sesMessageId: string | null }>}
 *   `sesMessageId` is set once SES has accepted the email (F07-T1: contact logs it)
 * @throws {ValidationError} for an unknown template, a bad address or bad placeholders
 */
export async function send(key, to, vars, options = {}) {
  const def = templateDef(key);
  if (def.copyOnly)
    throw new ValidationError("This email is not sent by the app", {
      key: "is not sent by the app",
    });
  const now = options.now ?? new Date();
  const toAddress = address(to, "to");
  const replyTo = options.replyTo ? address(options.replyTo, "replyTo") : null;
  // F08-FIX-8: a relayed buyer message without the buyer as reply-to would fall back to
  // OCP's address.
  if (def.requiresReplyTo && !replyTo)
    throw new ValidationError("This email needs a reply-to address", {
      replyTo: "is required",
    });
  const clean = cleanVars(key, vars);
  const idempotencyKey = options.idempotencyKey ?? null;

  const existing = idempotencyKey
    ? await prisma.emailOutbox.findUnique({ where: { idempotencyKey } })
    : null;
  if (existing)
    return {
      status: /** @type {OutboxStatus} */ (existing.status),
      outboxId: existing.id,
      sesMessageId: existing.sesMessageId,
    };

  let row;
  try {
    row = await prisma.emailOutbox.create({
      data: {
        templateKey: key,
        stream: def.stream,
        toAddress,
        replyTo,
        vars: def.sensitive ? Prisma.DbNull : clean,
        status: "SENDING",
        nextAttemptAt: now,
        idempotencyKey,
      },
    });
  } catch (error) {
    // The same key was stored a moment ago by another request.
    if (error?.code !== "P2002" || !idempotencyKey) throw error;
    const first = await prisma.emailOutbox.findUniqueOrThrow({
      where: { idempotencyKey },
    });
    return {
      status: /** @type {OutboxStatus} */ (first.status),
      outboxId: first.id,
      sesMessageId: first.sesMessageId,
    };
  }

  if (!def.sensitive)
    return withSesId(
      await attempt(row, clean, { now, retryLater: true }),
      row.id,
    );

  let current = row;
  let status = await attempt(current, clean, {
    now,
    retryLater: false,
    quiet: true,
  });
  for (let tries = 1; status === "FAILED" && tries < IMMEDIATE_TRIES; tries++) {
    const next = await prisma.emailOutbox.findUnique({ where: { id: row.id } });
    if (!next || PERMANENT.includes(next.lastErrorCode ?? "")) break;
    current = next;
    status = await attempt(current, clean, {
      now,
      retryLater: false,
      quiet: true,
    });
  }
  if (status === "FAILED") {
    const last = await prisma.emailOutbox.findUnique({ where: { id: row.id } });
    if (last) await reportFailure(last, status, last.lastErrorCode, now);
  }
  return withSesId(status, row.id);
}

/**
 * @param {OutboxStatus} status
 * @param {string} outboxId
 * @returns {Promise<{ status: OutboxStatus, outboxId: string, sesMessageId: string | null }>}
 */
async function withSesId(status, outboxId) {
  if (status !== "SENT") return { status, outboxId, sesMessageId: null };
  const row = await prisma.emailOutbox.findUnique({
    where: { id: outboxId },
    select: { sesMessageId: true },
  });
  return { status, outboxId, sesMessageId: row?.sesMessageId ?? null };
}

/**
 * Report a problem when too many of the last day's emails bounced or drew a complaint.
 * @param {Date} now
 */
async function checkRates(now) {
  const since = new Date(now.getTime() - 24 * 60 * MINUTE);
  const [sent, bounces, complaints] = await Promise.all([
    prisma.emailOutbox.count({ where: { sentAt: { gte: since } } }),
    prisma.emailSuppression.count({
      where: { reason: "BOUNCE", createdAt: { gte: since } },
    }),
    prisma.emailSuppression.count({
      where: { reason: "COMPLAINT", createdAt: { gte: since } },
    }),
  ]);
  if (sent < MIN_SENT_FOR_RATES) return;
  if (bounces / sent > MAX_BOUNCE_RATE)
    await reportEmailProblem(
      "email-bounce-rate",
      "Too many emails bounced in the last day.",
      { sent, bounces },
      { now },
    );
  if (complaints / sent > MAX_COMPLAINT_RATE)
    await reportEmailProblem(
      "email-complaint-rate",
      "Too many emails were marked as spam in the last day.",
      { sent, complaints },
      { now },
    );
}

/**
 * The hourly task: retry queued emails, tidy finished rows, check bounce and complaint
 * rates. Safe to run twice: each row is claimed before it is tried.
 * @param {{ now?: Date }} [context]
 * @returns {Promise<{ sent: number, pending: number, failed: number, purged: number }>}
 */
export async function runOutbox({ now = new Date() } = {}) {
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MS);
  const due = await prisma.emailOutbox.findMany({
    where: {
      OR: [
        { status: "PENDING", nextAttemptAt: { lte: now } },
        // A send that was cut off part-way (the server stopped) is picked up again.
        { status: "SENDING", nextAttemptAt: { lte: stuckBefore } },
      ],
    },
    orderBy: { nextAttemptAt: "asc" },
    take: BATCH,
  });

  const summary = { sent: 0, pending: 0, failed: 0, purged: 0 };
  for (const row of due) {
    const claimed = await prisma.emailOutbox.updateMany({
      where: {
        id: row.id,
        status: row.status,
        nextAttemptAt: row.nextAttemptAt,
      },
      data: { status: "SENDING", nextAttemptAt: now },
    });
    if (claimed.count === 0) continue;
    const hasVars = typeof row.vars === "object" && row.vars !== null;
    const status = hasVars
      ? await attempt(row, /** @type {Record<string, unknown>} */ (row.vars), {
          now,
          retryLater: true,
        })
      : // Nothing was stored to send (a cut-off email with private data): close the row.
        await prisma.emailOutbox
          .update({
            where: { id: row.id },
            data: { status: "FAILED", lastErrorCode: "Interrupted" },
          })
          .then(() => "FAILED");
    if (status === "SENT") summary.sent += 1;
    else if (status === "PENDING") summary.pending += 1;
    else summary.failed += 1;
  }

  const purged = await prisma.emailOutbox.deleteMany({
    where: {
      status: { in: FINISHED },
      createdAt: { lt: new Date(now.getTime() - KEEP_FINISHED_MS) },
    },
  });
  summary.purged = purged.count;
  await checkRates(now);
  return summary;
}
