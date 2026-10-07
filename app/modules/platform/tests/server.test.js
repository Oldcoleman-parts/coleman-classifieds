import { randomBytes } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServerApp } from "@/modules/platform/server/app.js";
import { logRequestError } from "@/modules/platform/index.js";

describe("server: createServerApp request logging", () => {
  let app;
  let server;
  let serverUrl;
  const capturedLogs = [];
  const capturedErrors = [];
  const stdoutWrites = [];
  const stderrWrites = [];

  beforeEach(() => {
    capturedLogs.length = 0;
    capturedErrors.length = 0;
    stdoutWrites.length = 0;
    stderrWrites.length = 0;

    vi.spyOn(console, "log").mockImplementation((...args) => {
      capturedLogs.push(args.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args) => {
      capturedErrors.push(args.join(" "));
    });
    vi.spyOn(process.stdout, "write").mockImplementation((data) => {
      stdoutWrites.push(String(data));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((data) => {
      stderrWrites.push(String(data));
      return true;
    });
  });

  afterEach(async () => {
    console.log.mockRestore();
    console.error.mockRestore();
    process.stdout.write.mockRestore();
    process.stderr.write.mockRestore();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  async function startApp(handler) {
    app = createServerApp({
      handler,
      assetsBuildDirectory: undefined,
    });
    return new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        serverUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  }

  it("AC1 + SEC: GET to /proxy/seller/<token> doesn't log token, logs request line", async () => {
    const token = randomBytes(32).toString("base64url");
    let handlerReached = false;
    await startApp((req, res) => {
      handlerReached = true;
      res.status(200).send("OK");
    });

    const response = await fetch(`${serverUrl}/proxy/seller/${token}`, {
      method: "GET",
    });

    expect(response.status).toBe(200);
    expect(handlerReached).toBe(true);
    const allOutput = [
      ...capturedLogs,
      ...capturedErrors,
      ...stdoutWrites,
      ...stderrWrites,
    ].join(" ");
    expect(allOutput).not.toContain(token);
    expect(allOutput).toContain("[redacted]");
    expect(allOutput).toMatch(/GET.*\[redacted\].*200.*ms/);
  });

  it("AC1 + SEC: POST to /proxy/seller/<token>/draft doesn't log token", async () => {
    const token = randomBytes(32).toString("base64url");
    let handlerReached = false;
    await startApp((req, res) => {
      handlerReached = true;
      res.status(200).send("OK");
    });

    const response = await fetch(`${serverUrl}/proxy/seller/${token}/draft`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(handlerReached).toBe(true);
    const allOutput = [
      ...capturedLogs,
      ...capturedErrors,
      ...stdoutWrites,
      ...stderrWrites,
    ].join(" ");
    expect(allOutput).not.toContain(token);
    expect(allOutput).toMatch(/POST.*\[redacted\].*draft.*200/);
  });

  it("AC2: no captured output contains ?, signature, email from query string", async () => {
    const token = randomBytes(32).toString("base64url");
    await startApp((req, res) => {
      res.status(200).send("OK");
    });

    await fetch(
      `${serverUrl}/proxy/seller/${token}?shop=x.myshopify.com&signature=abc123def456&email=someone@example.com`,
    );

    const allOutput = [
      ...capturedLogs,
      ...capturedErrors,
      ...stdoutWrites,
      ...stderrWrites,
    ].join(" ");
    expect(allOutput).toMatch(/GET \/proxy\/seller\/\[redacted\] 200 \d+ms/);
    expect(allOutput).not.toContain("?");
    expect(allOutput).not.toContain("abc123def456");
    expect(allOutput).not.toContain("someone@example.com");
    expect(allOutput).not.toContain("signature");
  });

  it("AC1: no x-powered-by header", async () => {
    await startApp((req, res) => {
      res.status(200).send("OK");
    });

    const response = await fetch(`${serverUrl}/`);

    expect(response.headers.has("x-powered-by")).toBe(false);
  });

  it("SEC: handler error logged without token, error line present", async () => {
    const token = randomBytes(32).toString("base64url");
    await startApp((req, res, next) => {
      next(new Error(`boom at /proxy/seller/${token}/draft`));
    });

    const response = await fetch(`${serverUrl}/proxy/seller/${token}/draft`);

    expect(response.status).toBe(500);
    const allOutput = [...capturedErrors, ...stderrWrites].join(" ");
    expect(allOutput).not.toContain(token);
    expect(allOutput).not.toContain("boom");
    expect(capturedErrors).toContain(
      "Error GET /proxy/seller/[redacted]/draft",
    );
  });

  it("SEC: malformed percent-encoded path logged without raw path", async () => {
    await startApp((req, res) => {
      res.status(200).send("OK");
    });

    const response = await fetch(`${serverUrl}/proxy/seller/%E0%A4%A`);

    expect(response.status).toBe(400);
    const allOutput = [
      ...capturedLogs,
      ...capturedErrors,
      ...stdoutWrites,
      ...stderrWrites,
    ].join(" ");
    expect(allOutput).not.toContain("%E0%A4%A");
    // Express stays silent under NODE_ENV=test, so check our own line was written.
    expect(capturedErrors).toContain("URIError GET /proxy/seller/[redacted]");
  });

  it("SEC: logRequestError with route error response (action-only route)", () => {
    capturedErrors.length = 0;
    const token = randomBytes(32).toString("base64url");
    const request = new Request(
      `https://shop.example/proxy/seller/${token}/draft?signature=abc123def456`,
    );
    const error = {
      status: 400,
      statusText: "Bad Request",
      internal: true,
      data: `Error: You made a GET request to "/proxy/seller/${token}/draft" but did not provide a \`loader\``,
      error: new Error(
        `You made a GET request to "/proxy/seller/${token}/draft" but did not provide a \`loader\``,
      ),
    };

    logRequestError(error, { request });

    const output = capturedErrors.join(" ");
    expect(output).not.toContain(token);
    expect(output).not.toContain("abc123def456");
    expect(capturedErrors).toEqual([
      "400 Bad Request GET /proxy/seller/[redacted]/draft",
    ]);
  });

  it("SEC: logRequestError with plain Error containing URL in message", () => {
    capturedErrors.length = 0;
    const token = randomBytes(32).toString("base64url");
    const url = `/proxy/seller/${token}/draft`;
    const request = new Request(`https://shop.example${url}`);
    const error = new Error(`Failed at ${url} with token ${token}`);

    logRequestError(error, { request });

    const output = capturedErrors.join(" ");
    expect(output).not.toContain(token);
    expect(output).toContain("[redacted]");
  });

  it("SEC: logRequestError with plain Error containing URL in stack", () => {
    capturedErrors.length = 0;
    const token = randomBytes(32).toString("base64url");
    const url = `/proxy/seller/${token}`;
    const request = new Request(`https://shop.example${url}`);
    const error = new Error("Something went wrong");
    error.stack = `Error: Something went wrong\n  at /path/to/file.js:123:456\n  URL was ${url} with token ${token}`;

    logRequestError(error, { request });

    const output = capturedErrors.join(" ");
    expect(output).not.toContain(token);
    expect(output).not.toContain(url);
    expect(output).toContain("GET /proxy/seller/[redacted]");
    expect(output).toContain("Something went wrong");
  });

  it("SEC: logRequestError with aborted request logs nothing", () => {
    capturedErrors.length = 0;
    const controller = new AbortController();
    controller.abort();
    const request = new Request("https://shop.example/proxy/seller/token", {
      signal: controller.signal,
    });
    const error = new Error("boom");

    logRequestError(error, { request });

    expect(capturedErrors).toHaveLength(0);
  });
});
