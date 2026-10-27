// The stored summary of each job run (F08-T1): the Health screen's "last job run", and
// what F08-T2's watchdog and repeated-failure incidents read.
import prisma from "@/db.server";

const KEEP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Store a run summary and drop rows older than 30 days. Never throws: a run that worked
 * isn't reported as failed because its record couldn't be saved.
 * @param {import("./registry.js").RunSummary} summary counts and IDs only
 */
export async function saveRun(summary) {
  try {
    const finishedAt = new Date(summary.finishedAt);
    await prisma.jobRun.create({
      data: {
        startedAt: new Date(summary.startedAt),
        finishedAt,
        ok: summary.ok,
        failedTasks: summary.results
          .filter((result) => !result.ok)
          .map((result) => result.task),
        results: summary.results,
      },
    });
    await prisma.jobRun.deleteMany({
      where: {
        finishedAt: { lt: new Date(finishedAt.getTime() - KEEP_DAYS * DAY_MS) },
      },
    });
  } catch (error) {
    console.error(`[jobs] run summary not saved: ${error?.name ?? "Error"}`);
  }
}

/**
 * @returns {Promise<{ finishedAt: Date, ok: boolean, failedTasks: string[] } | null>} null
 *   before the first run
 */
export function getLastRun() {
  return prisma.jobRun.findFirst({
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true, ok: true, failedTasks: true },
  });
}
