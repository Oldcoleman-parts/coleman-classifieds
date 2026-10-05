// Public API of the scheduler module. Other modules import only from here.
import { isAuthorizedJobRequest } from "./auth.js";
import { resetTasks, runTasks } from "./registry.js";

export { registerTask, runTasks } from "./registry.js";

/**
 * Handle `POST /jobs/run`: the hourly cron's only entry point.
 * @param {Request} request
 * @returns {Promise<Response>} 401 without the bearer secret, otherwise the run summary
 */
export async function handleJobsRequest(request) {
  if (request.method !== "POST")
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  if (!isAuthorizedJobRequest(request))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  // A failed task is reported in the summary, not as an HTTP error: the run itself worked.
  return Response.json(await runTasks());
}

/**
 * Called from the app bootstrap, before the feature modules, which add their tasks with
 * `registerTask()`. F01 has no tasks of its own.
 */
export function register() {
  resetTasks();
}
