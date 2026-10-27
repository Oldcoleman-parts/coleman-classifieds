import { describe, it, expect } from "vitest";
import { parseHistoryFilter } from "@/modules/console/index.js";
import { ValidationError } from "@/modules/core/index.js";

// America/New_York (tests/setup/env.js). The 2025-10-27 → 2026-10-27 range spans the
// clock changes of 2025-11-02 and 2026-03-08; 2026-03-01 → 2027-03-01 spans 2026-03-08
// and 2026-11-01.
describe("F05-FIX-1: History date range limit", () => {
  it.each([
    ["366 days across the 2026 DST change", "2025-10-27", "2026-10-27", null],
    ["366 days across March DST", "2026-03-01", "2027-03-01", null],
    ["367 days is refused", "2025-10-26", "2026-10-27", "to"],
    ["367 days across March DST is refused", "2026-03-01", "2027-03-02", "to"],
  ])("AC: %s", (_label, from, to, refusedField) => {
    if (refusedField === null) {
      const filter = parseHistoryFilter({ from, to });
      expect(filter).toMatchObject({ from, to });
      return;
    }
    let thrown;
    try {
      parseHistoryFilter({ from, to });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ValidationError);
    expect(thrown.fields[refusedField]).toBeDefined();
  });
});
