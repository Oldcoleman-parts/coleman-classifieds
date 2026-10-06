import { describe, expect, it, vi } from "vitest";

const registerTask = vi.fn();
vi.mock("@/modules/scheduler/index.js", () => ({ registerTask }));

const { register } = await import("@/modules/media/index.js");

describe("media register()", () => {
  it("AC: registers the hourly unpublish-closed sweep next to retention", () => {
    register();
    const names = registerTask.mock.calls.map(([name]) => name);
    expect(names).toEqual(
      expect.arrayContaining([
        "media.purge-closed-photos",
        "media.unpublish-closed",
      ]),
    );
  });
});
