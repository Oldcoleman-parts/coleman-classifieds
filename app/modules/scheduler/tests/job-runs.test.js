import { describe, it, expect, beforeEach } from "vitest";
import prisma from "@/db.server";
import {
  getLastRun,
  handleJobsRequest,
  registerTask,
  runTasks,
} from "@/modules/scheduler/index.js";
import {
  DAY_MS,
  opsWorld,
  rowOf,
  seedListing,
} from "@/modules/ops/tests/helpers.js";

const SECRET = "test-jobs-secret";

/** `POST /jobs/run?task=…` with the bearer secret (or another value, or none). */
function jobsRequest(query = "", secret = SECRET) {
  return new Request(`https://app.example.test/jobs/run${query}`, {
    method: "POST",
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  });
}

describe("Job runs and recovery (F08-T1)", () => {
  beforeEach(async () => {
    await opsWorld();
    registerTask("test.boom", async () => {
      throw new Error("boom");
    });
  });

  it("AC: one failing task doesn't stop the ops tasks", async () => {
    const summary = await runTasks();
    const others = summary.results.filter(({ task }) => task !== "test.boom");
    expect(others.length).toBeGreaterThan(1);
    expect(others.every(({ ok }) => ok)).toBe(true);
    expect(summary.results.find(({ task }) => task === "test.boom").ok).toBe(
      false,
    );
  });

  it("AC: getLastRun is null before any run", async () => {
    expect(await getLastRun()).toBeNull();
  });

  it("AC: getLastRun reports a failing task after a run", async () => {
    await runTasks();
    const last = await getLastRun();
    expect(last.ok).toBe(false);
    expect(last.failedTasks).toEqual(["test.boom"]);
  });

  it("AC: ?task=ops.expire-month runs only that task", async () => {
    const listing = await seedListing("LIVE", {
      liveAt: new Date(Date.now() - 40 * DAY_MS),
      expiresAt: new Date(Date.now() - DAY_MS),
    });
    const response = await handleJobsRequest(
      jobsRequest("?task=ops.expire-month"),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.results.map(({ task }) => task)).toEqual(["ops.expire-month"]);
    expect((await rowOf(listing.id)).status).toBe("EXPIRED");
  });

  it("AC: ?task= with an unknown name returns 400", async () => {
    const response = await handleJobsRequest(jobsRequest("?task=ops.nope"));
    expect(response.status).toBe(400);
  });

  it("SEC: ?task= with a wrong bearer secret returns 401 and runs nothing", async () => {
    const listing = await seedListing("LIVE", {
      liveAt: new Date(Date.now() - 40 * DAY_MS),
      expiresAt: new Date(Date.now() - DAY_MS),
    });
    const response = await handleJobsRequest(
      jobsRequest("?task=ops.expire-month", "wrong-secret"),
    );
    expect(response.status).toBe(401);
    expect((await rowOf(listing.id)).status).toBe("LIVE");
  });

  it("AC: after a full run and then a ?task= run, getLastRun() returns the full run", async () => {
    registerTask("test.ok", async () => ({ ok: true }));
    await runTasks();
    const response = await handleJobsRequest(jobsRequest("?task=test.ok"));
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);

    const last = await getLastRun();
    expect(last.ok).toBe(false);
    expect(last.failedTasks).toEqual(["test.boom"]);

    const partial = await prisma.jobRun.findFirst({ where: { partial: true } });
    expect(partial.ok).toBe(true);
  });

  it("AC: a run without ?task= is stored with partial false", async () => {
    await runTasks();
    const stored = await prisma.jobRun.findFirst({
      orderBy: { finishedAt: "desc" },
    });
    expect(stored.partial).toBe(false);
  });
});
