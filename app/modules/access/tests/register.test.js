import { describe, it, expect, vi } from "vitest";

const registerTask = vi.fn();
vi.mock("@/modules/scheduler/index.js", () => ({ registerTask }));

const { register } = await import("@/modules/access/index.js");

describe("access register()", () => {
  it("AC: access.expire-invitations task is registered", () => {
    register();
    const names = registerTask.mock.calls.map(([name]) => name);
    expect(names).toContain("access.expire-invitations");
  });
});
