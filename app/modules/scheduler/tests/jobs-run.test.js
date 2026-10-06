import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { resetDb } from "@/../tests/db.js";
import {
  handleJobsRequest,
  registerTask,
  runTasks,
  register,
} from "@/modules/scheduler/index.js";

function createJobsRequest(secret = null) {
  return new Request("https://app.example.test/jobs/run", {
    method: "POST",
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  });
}

describe("Jobs endpoint (AC + SEC: authentication and task execution)", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(() => {
    process.env.JOBS_SECRET = "test-jobs-secret";
    register(); // Reset task registry
  });

  describe("AC + SEC: Authentication", () => {
    it("AC + SEC: no Authorization header returns 401", async () => {
      const request = createJobsRequest();
      const response = await handleJobsRequest(request);

      expect(response.status).toBe(401);
    });

    it("AC + SEC: wrong secret returns 401", async () => {
      const request = createJobsRequest("wrong-secret");
      const response = await handleJobsRequest(request);

      expect(response.status).toBe(401);
    });

    it("AC: correct secret returns 200 with JSON", async () => {
      const request = createJobsRequest("test-jobs-secret");
      const response = await handleJobsRequest(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain(
        "application/json",
      );

      const data = await response.json();
      expect(data).toHaveProperty("startedAt");
      expect(data).toHaveProperty("finishedAt");
      expect(data).toHaveProperty("ok");
      expect(data).toHaveProperty("results");
      expect(Array.isArray(data.results)).toBe(true);
    });

    it("AC: GET request returns 405", async () => {
      const request = new Request("https://app.example.test/jobs/run", {
        method: "GET",
        headers: { Authorization: "Bearer test-jobs-secret" },
      });

      const response = await handleJobsRequest(request);
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST");
    });
  });

  describe("AC: Task execution and results", () => {
    it("AC: successful task is reported with ok: true", async () => {
      registerTask(
        "test.success",
        async () => ({
          count: 1,
        }),
        { timeoutMs: 5000 },
      );

      const summary = await runTasks();

      expect(summary.ok).toBe(true);
      expect(summary.results).toHaveLength(1);
      expect(summary.results[0].task).toBe("test.success");
      expect(summary.results[0].ok).toBe(true);
      expect(summary.results[0].summary).toEqual({ count: 1 });
    });

    it("AC: task that throws is reported with ok: false", async () => {
      registerTask(
        "test.failing",
        async () => {
          throw new Error("Task failed");
        },
        { timeoutMs: 5000 },
      );

      const summary = await runTasks();

      expect(summary.ok).toBe(false);
      expect(summary.results[0].task).toBe("test.failing");
      expect(summary.results[0].ok).toBe(false);
      expect(summary.results[0].error).toBe("Error");
    });

    it("AC: one failing task does not stop others", async () => {
      const order = [];

      registerTask("test.first", async () => {
        order.push("first");
      });

      registerTask("test.second", async () => {
        order.push("second");
        throw new Error("Second failed");
      });

      registerTask("test.third", async () => {
        order.push("third");
      });

      const summary = await runTasks();

      expect(order).toEqual(["first", "second", "third"]);
      expect(summary.results).toHaveLength(3);
      expect(summary.results[0].ok).toBe(true);
      expect(summary.results[1].ok).toBe(false);
      expect(summary.results[2].ok).toBe(true);
    });

    it("AC: task past timeoutMs is reported as TIMEOUT", async () => {
      registerTask(
        "test.timeout",
        async () => {
          // Sleep longer than timeout
          await new Promise((resolve) => setTimeout(resolve, 2000));
        },
        { timeoutMs: 100 },
      );

      const summary = await runTasks();

      expect(summary.results[0].ok).toBe(false);
      expect(summary.results[0].error).toBe("TIMEOUT");
    });
  });

  describe("AC: runTasks options", () => {
    it("AC: only option limits tasks run", async () => {
      registerTask("test.included", async () => ({
        ran: true,
      }));

      registerTask("test.excluded", async () => ({
        ran: false,
      }));

      const summary = await runTasks({ only: ["test.included"] });

      expect(summary.results).toHaveLength(1);
      expect(summary.results[0].task).toBe("test.included");
    });

    it("AC: now option is passed to tasks", async () => {
      const testTime = new Date("2027-01-15T12:00:00Z");
      let taskNow;

      registerTask("test.time", async ({ now }) => {
        taskNow = now;
      });

      await runTasks({ now: testTime });

      expect(taskNow).toEqual(testTime);
    });
  });
});
