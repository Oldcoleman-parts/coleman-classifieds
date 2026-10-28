import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/scheduler/index.js", () => ({
  register: vi.fn(),
  registerTask: vi.fn(),
}));
const subscribed = [];
vi.mock("@/modules/core/index.js", async (original) => {
  const core = await original();
  return {
    ...core,
    subscribe: (name, handler) => {
      subscribed.push(name);
      return core.subscribe(name, handler);
    },
  };
});

describe("workspace register()", () => {
  it("AC: the app bootstrap wires the revision decision listeners", async () => {
    await import("@/bootstrap.server.js");

    expect(subscribed).toEqual(
      expect.arrayContaining(["RevisionApproved", "RevisionRejected"]),
    );
    // Media, then workspace, then publishing (F06-T2), as the bootstrap order says.
    expect(
      subscribed.filter((name) => name === "RevisionApproved"),
    ).toHaveLength(3);
  });
});
