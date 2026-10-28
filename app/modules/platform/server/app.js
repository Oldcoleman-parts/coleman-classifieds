// The production Express app (F01-FIX-7). It does what `react-router-serve` does, except that
// its URL logger is replaced by the redacted request log. Plain Node: no `@/` imports.
import path from "node:path";
import compression from "compression";
import express from "express";
import { redactRequestPath, requestLog } from "./request-log.js";

/**
 * @param {object} options
 * @param {import("express").RequestHandler} options.handler the React Router request handler
 * @param {string} [options.publicPath] from the server build
 * @param {string} [options.assetsBuildDirectory] from the server build
 * @param {(line: string) => void} [options.log]
 * @param {(line: string) => void} [options.logError]
 * @returns {import("express").Application}
 */
export function createServerApp({
  handler,
  publicPath = "/",
  assetsBuildDirectory,
  log = console.log,
  logError = console.error,
}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(compression());

  if (assetsBuildDirectory) {
    app.use(
      path.posix.join(publicPath, "assets"),
      express.static(path.join(assetsBuildDirectory, "assets"), {
        immutable: true,
        maxAge: "1y",
      }),
    );
    app.use(publicPath, express.static(assetsBuildDirectory));
  }
  app.use(express.static("public", { maxAge: "1h" }));

  // After the static files, so assets are not logged.
  app.use(requestLog(log));
  app.all("*", handler);

  // Express's own error handler prints the stack, and its messages can quote the URL
  // ("Failed to decode param '/proxy/seller/…'"). Log the error name and the safe path only.
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    logError(
      `${error?.name ?? "Error"} ${req.method} ${redactRequestPath(req.originalUrl)}`,
    );
    if (res.headersSent) return res.end();
    const status =
      error?.status >= 400 && error?.status < 600 ? error.status : 500;
    res
      .status(status)
      .type("text/plain")
      .send(status === 500 ? "Unexpected Server Error" : "Bad Request");
  });

  return app;
}
