// System health (`/app/health`): open problems, the last job run, email and the live count.
// Only fixed fields, counts and dates leave this file: never configuration, connection
// strings, error text or an incident's raw details.
import prisma from "@/db.server";
import {
  requireId,
  requireStaff,
  ValidationError,
  writeAudit,
} from "@/modules/core/index.js";
import { getHealthProviders } from "./providers.js";

const DAY_MS = 86_400_000;

/** @param {{ now?: Date }} [options] */
export async function loadHealthScreen({ now = new Date() } = {}) {
  const { incidents, jobs, email, liveCount } = getHealthProviders();
  const [open, lastRun, emailHealth, storefront, dbLive, problems24h] =
    await Promise.all([
      incidents ? incidents.listOpen() : null,
      jobs ? jobs.getLastRun() : null,
      email ? email.getHealth() : null,
      liveCount ? liveCount.getStorefrontCount() : null,
      prisma.listing.count({ where: { status: "LIVE" } }),
      // Notifications records a failed or bounced email as an `EmailProblem` audit entry.
      prisma.auditEvent.count({
        where: {
          action: "EmailProblem",
          at: { gte: new Date(now.getTime() - DAY_MS) },
        },
      }),
    ]);
  const storefrontCount = typeof storefront === "number" ? storefront : null;

  return {
    incidents: {
      available: Boolean(incidents),
      rows: (open ?? []).map((incident) => ({
        id: incident.id,
        kind: incident.kind,
        message: incident.message,
        firstSeen: new Date(incident.firstSeen).toISOString(),
        lastSeen: new Date(incident.lastSeen).toISOString(),
      })),
    },
    lastJobRun: {
      available: Boolean(jobs),
      finishedAt: lastRun ? new Date(lastRun.finishedAt).toISOString() : null,
      ok: lastRun ? lastRun.ok === true : null,
      failedTasks: lastRun ? lastRun.failedTasks.map(String) : [],
    },
    email: {
      available: Boolean(email),
      ok: emailHealth ? emailHealth.ok === true : null,
      problems24h,
    },
    liveCount: {
      dbLive,
      storefront: storefrontCount,
      matches: storefrontCount === null ? null : storefrontCount === dbLive,
    },
  };
}

/**
 * Mark an open problem as resolved (`intent=resolve-incident`, `incidentId`).
 * @param {FormData} formData
 * @param {import("@/modules/core/types.js").ActorRef} actor the staff member, from the session
 * @returns {Promise<{ ok: true, intent: string, already: boolean } | { ok: false, message: string, status: number }>}
 */
export async function handleHealthAction(formData, actor) {
  const staff = requireStaff(actor);
  const intent = formData.get("intent");
  if (intent !== "resolve-incident")
    return { ok: false, message: "Unknown action", status: 400 };
  const { incidents } = getHealthProviders();
  if (!incidents)
    return { ok: false, message: "Problems aren’t tracked yet.", status: 404 };

  let incidentId;
  try {
    incidentId = requireId(formData.get("incidentId"), "incidentId");
  } catch (error) {
    if (error instanceof ValidationError)
      return { ok: false, message: "That problem wasn’t found.", status: 400 };
    throw error;
  }

  const result = await incidents.resolve(incidentId, staff);
  if (result.changed)
    await writeAudit({
      action: "IncidentResolved",
      actor: staff,
      details: { incidentId, kind: result.kind ?? null },
    });
  return { ok: true, intent, already: !result.changed };
}
