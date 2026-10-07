// Production entry: `node ./app/modules/platform/server/start.js ./build/server/index.js`.
// Replaces `react-router-serve`, which always logs the full request URL and so writes seller
// links to the hosting logs (F01-FIX-7). `shopify app dev` does not use this file.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { createRequestHandler } from "@react-router/express";
import sourceMapSupport from "source-map-support";
import { createServerApp } from "./app.js";

process.env.NODE_ENV = process.env.NODE_ENV ?? "production";

sourceMapSupport.install({
  retrieveSourceMap(source) {
    if (!source.startsWith("file://")) return null;
    const mapPath = `${url.fileURLToPath(source)}.map`;
    if (!fs.existsSync(mapPath)) return null;
    return { url: source, map: fs.readFileSync(mapPath, "utf8") };
  },
});

const buildPathArg = process.argv[2];
if (!buildPathArg) {
  console.error(
    "Usage: node app/modules/platform/server/start.js <server-build-path>",
  );
  process.exit(1);
}

const buildPath = path.resolve(buildPathArg);
const build = await import(url.pathToFileURL(buildPath).href);

const app = createServerApp({
  handler: createRequestHandler({ build, mode: process.env.NODE_ENV }),
  publicPath: build.publicPath,
  assetsBuildDirectory: build.assetsBuildDirectory,
});

const port = Number(process.env.PORT) || 3000;
const onListen = () => console.log(`[server] listening on port ${port}`);
const server = process.env.HOST
  ? app.listen(port, process.env.HOST, onListen)
  : app.listen(port, onListen);

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () =>
    server.close((error) => error && console.error(error.name)),
  );
}
