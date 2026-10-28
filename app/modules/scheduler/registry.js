// The task registry behind /jobs/run. Features add tasks with `registerTask()`.
import { ValidationError } from "@/modules/core/index.js";
import { saveRun } from "./runs.js";

/**
 * @typedef {(context: { now: Date }) => unknown | Promise<unknown>} TaskRun returns a short
 *   summary (counts and IDs only), which goes into the run result and the log
 * @typedef {{ task: string, ok: boolean, durationMs: number, summary?: unknown, error?: string }} TaskResult
 * @typedef {{ startedAt: string, finishedAt: string, ok: boolean, partial: boolean, results: TaskResult[] }} RunSummary
 *   `partial` is a `?task=` run (F08-FIX-2)
 */

/** @type {Map<string, { run: TaskRun, timeoutMs: number }>} */
const tasks = new Map();

/**
 * @param {string} name unique, e.g. "payments.lapse-unpaid"
 * @param {TaskRun} run must be idempotent: two runs have the effect of one
 * @param {{ timeoutMs?: number }} [options] the time box for one run (default one minute)
 */
export function registerTask(name, run, { timeoutMs = 60_000 } = {}) {
  if (tasks.has(name))
    throw new ValidationError(`Task ${name} is already registered`);
  tasks.set(name, { run, timeoutMs });
}

/** Remove every task. Called when the scheduler module registers. */
export function resetTasks() {
  tasks.clear();
}

function timeBox(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Run the registered tasks one after the other. A task that throws or runs past its time
 * box is reported and the rest still run.
 * @param {{ now?: Date, only?: string[] }} [options] `only` limits the run to these task names
 * @returns {Promise<RunSummary>}
 */
export async function runTasks({ now = new Date(), only } = {}) {
  const startedAt = new Date();
  /** @type {TaskResult[]} */
  const results = [];
  for (const [task, { run, timeoutMs }] of tasks) {
    if (only && !only.includes(task)) continue;
    const begun = Date.now();
    try {
      const summary = await timeBox(
        Promise.resolve().then(() => run({ now })),
        timeoutMs,
      );
      results.push({
        task,
        ok: true,
        durationMs: Date.now() - begun,
        ...(summary === undefined ? {} : { summary }),
      });
    } catch (error) {
      // The error type only: messages can carry personal data or connection details.
      const reason =
        error?.message === "TIMEOUT"
          ? "TIMEOUT"
          : [error?.name, error?.code].filter(Boolean).join(" ") || "Error";
      results.push({
        task,
        ok: false,
        durationMs: Date.now() - begun,
        error: reason,
      });
    }
  }
  const summary = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    ok: results.every((result) => result.ok),
    partial: Array.isArray(only),
    results,
  };
  console.log(`[jobs] ${JSON.stringify(summary)}`);
  await saveRun(summary);
  return summary;
}

/** @returns {string[]} the registered task names, in run order */
export const taskNames = () => [...tasks.keys()];
