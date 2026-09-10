import { describe, expect, it } from "vitest";
import { addMonths, monthDiff, periodOf, unclosedPeriods } from "../period";

describe("periodOf", () => {
  it("takes the YYYY-MM prefix of a date", () => {
    expect(periodOf("2026-09-10")).toBe("2026-09");
  });
});

describe("monthDiff", () => {
  it("is zero for the same period", () => {
    expect(monthDiff("2026-09", "2026-09")).toBe(0);
  });

  it("counts whole months forward", () => {
    expect(monthDiff("2026-09", "2026-12")).toBe(3);
  });

  it("counts across a year boundary", () => {
    expect(monthDiff("2026-11", "2027-02")).toBe(3);
  });

  it("is negative when toPeriod precedes fromPeriod", () => {
    expect(monthDiff("2026-09", "2026-06")).toBe(-3);
  });
});

describe("addMonths", () => {
  it("adds whole months within a year", () => {
    expect(addMonths("2026-09", 2)).toBe("2026-11");
  });

  it("rolls over into the next year", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
  });

  it("rolls back into the previous year with a negative count", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
});

describe("unclosedPeriods", () => {
  // A brand-new user's first Review closes only the immediately preceding
  // Period, not every month since the epoch.
  it("returns only the previous period when nothing has ever been closed", () => {
    expect(unclosedPeriods(undefined, "2026-09")).toEqual(["2026-08"]);
  });

  it("returns nothing when the last closed period is the one before current", () => {
    expect(unclosedPeriods("2026-08", "2026-09")).toEqual([]);
  });

  it("returns nothing when the last closed period is the current one", () => {
    expect(unclosedPeriods("2026-09", "2026-09")).toEqual([]);
  });

  it("returns every period strictly between last closed and current", () => {
    expect(unclosedPeriods("2026-06", "2026-09")).toEqual(["2026-07", "2026-08"]);
  });
});
