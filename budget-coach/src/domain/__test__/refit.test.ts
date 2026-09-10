import { describe, expect, it } from "vitest";
import { computeRefit } from "../refit";
import { computeCap, sumCommitments } from "../commitment";
import { unclosedPeriods } from "../period";
import type { SavingsPot } from "../savings-pot";

const period = "2026-09";

const rate = (id: string, ratePerMonth: number): SavingsPot => ({
  id,
  kind: "rate",
  name: id,
  ratePerMonth,
  balance: 0,
});

describe("computeCap", () => {
  it("is forecast income minus every pot's rate", () => {
    expect(computeCap({ forecastIncome: 3000, pots: [rate("a", 500), rate("b", 200)], period })).toBe(2300);
  });

  it("is the full income when nothing is committed", () => {
    expect(computeCap({ forecastIncome: 3000, pots: [], period })).toBe(3000);
  });
});

describe("computeRefit", () => {
  it("reports fits when limits already sit under the cap", () => {
    const refit = computeRefit({
      forecastIncome: 3000,
      pots: [rate("a", 500)],
      categoryLimits: { Dining: 200, Groceries: 400 },
      period,
    });

    expect(refit.outcome).toBe("fits");
    expect(refit).toMatchObject({ cap: 2500, headroom: 1900 });
  });

  // The scenario ADR-0014 exists to fix: a new commitment eats headroom the
  // limits were relying on, so the limits must come down.
  it("scales limits proportionally when a commitment pushes them over the cap", () => {
    const refit = computeRefit({
      forecastIncome: 3000,
      pots: [rate("a", 1500)],
      categoryLimits: { Dining: 1000, Groceries: 1000 },
      period,
    });

    expect(refit.outcome).toBe("cuts");
    if (refit.outcome !== "cuts") throw new Error("expected cuts");
    expect(refit.cap).toBe(1500);
    expect(refit.proposedLimits).toEqual({ Dining: 750, Groceries: 750 });
  });

  // Threshold is cap <= 0, not "the cuts look big" — a merely painful refit
  // still goes to the user so they can decline it.
  it("reports impossible only when commitments meet or exceed income", () => {
    const painful = computeRefit({
      forecastIncome: 3000,
      pots: [rate("a", 2900)],
      categoryLimits: { Dining: 1000 },
      period,
    });
    expect(painful.outcome).toBe("cuts");

    const impossible = computeRefit({
      forecastIncome: 3000,
      pots: [rate("a", 3000)],
      categoryLimits: { Dining: 1000 },
      period,
    });
    expect(impossible.outcome).toBe("impossible");
    expect(impossible).toMatchObject({ cap: 0, commitments: 3000 });
  });

  it("sums commitments across every pot", () => {
    expect(sumCommitments([rate("a", 500), rate("b", 125.5)], period)).toBe(625.5);
  });
});

describe("unclosedPeriods", () => {
  it("returns nothing when last month is already closed", () => {
    expect(unclosedPeriods("2026-08", "2026-09")).toEqual([]);
  });

  // ADR-0012: skipping a month defers its close rather than losing it.
  it("returns every skipped month, in order, excluding the current one", () => {
    expect(unclosedPeriods("2026-05", "2026-09")).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  it("closes only the previous month for a user who has never closed one", () => {
    expect(unclosedPeriods(undefined, "2026-09")).toEqual(["2026-08"]);
  });

  it("handles a year boundary", () => {
    expect(unclosedPeriods("2025-11", "2026-02")).toEqual(["2025-12", "2026-01"]);
  });
});
