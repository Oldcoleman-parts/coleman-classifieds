// React Router's `handleError` for the server entry (F01-FIX-7). The default one prints the
// error as it is, and a route error quotes the request path: a GET to a POST-only seller route
// gives `You made a GET request to "/proxy/seller/<token>/draft" but did not provide a loader`.
import { isRouteErrorResponse } from "react-router";
import { redactRequestPath, scrubUrl } from "../server/request-log.js";

/**
 * @param {unknown} error
 * @param {{ request: Request }} args
 */
export function logRequestError(error, { request }) {
  if (request.signal.aborted) return;
  const where = `${request.method} ${redactRequestPath(request.url)}`;
  if (isRouteErrorResponse(error)) {
    // Never the message or the data: both can hold the path.
    console.error(
      `${error.status} ${scrubUrl(error.statusText, request.url)} ${where}`,
    );
    return;
  }
  const detail =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`${where}\n${scrubUrl(detail, request.url)}`);
}
