// Public API of the scheduler module. Other modules import only from here.
import { isAuthorizedJobRequest } from "./auth.js";
import { resetTasks, runTasks, taskNames } from "./registry.js";

export { registerTask, runTasks } from "./registry.js";
export { getLastRun } from "./runs.js";

/**
 * Handle `POST /jobs/run`: the hourly cron's only entry point.
 * @param {Request} request
 * `?task=<name>` (repeatable) runs only those tasks, e.g. for recovery (F08-T1).
 * @returns {Promise<Response>} 401 without the bearer secret, 400 for an unknown task name,
 *   otherwise the run summary
 */
export async function handleJobsRequest(request) {
  if (request.method !== "POST")
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  if (!isAuthorizedJobRequest(request))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const only = new URL(request.url).searchParams.getAll("task");
  const known = taskNames();
  if (only.some((name) => !known.includes(name)))
    return Response.json({ error: "Unknown task" }, { status: 400 });
  // A failed task is reported in the summary, not as an HTTP error: the run itself worked.
  return Response.json(await runTasks(only.length > 0 ? { only } : undefined));
}

/**
 * Called from the app bootstrap, before the feature modules, which add their tasks with
 * `registerTask()`. F01 has no tasks of its own.
 */
export function register() {
  resetTasks();
}
