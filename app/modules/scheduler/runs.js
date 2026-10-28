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
        partial: summary.partial === true,
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
 * The last full run. DECISION (F08-FIX-2): a `?task=` recovery run is stored with
 * `partial: true` and skipped here, so one task's result is never reported as the last run;
 * which tasks it ran is already in `results`.
 * @returns {Promise<{ finishedAt: Date, ok: boolean, failedTasks: string[] } | null>} null
 *   before the first full run
 */
export function getLastRun() {
  return prisma.jobRun.findFirst({
    where: { partial: false },
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true, ok: true, failedTasks: true },
  });
}
