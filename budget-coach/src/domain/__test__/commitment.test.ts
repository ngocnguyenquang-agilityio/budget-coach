import { describe, expect, it } from "vitest";
import { computeCap, sumCommitments } from "../commitment";
import type { SavingsPot } from "../savings-pot";

const period = "2026-09";

const ratePot = (ratePerMonth: number): SavingsPot => ({
  id: "rate",
  kind: "rate",
  name: "General savings",
  ratePerMonth,
  balance: 0,
});

const targetPot = (targetAmount: number, balance: number, deadline?: string): SavingsPot => ({
  id: "target",
  kind: "target",
  name: "Laptop",
  targetAmount,
  balance,
  ...(deadline ? { deadline } : {}),
});

describe("sumCommitments", () => {
  it("is zero with no pots", () => {
    expect(sumCommitments([], period)).toBe(0);
  });

  it("sums the current rate of every pot", () => {
    const pots = [ratePot(500), targetPot(900, 300, "2026-12")];
    // 500 + (600 / 4 months) = 500 + 150
    expect(sumCommitments(pots, period)).toBe(650);
  });

  it("excludes an open-ended target pot's claim", () => {
    expect(sumCommitments([ratePot(500), targetPot(900, 300)], period)).toBe(500);
  });
});

describe("computeCap", () => {
  it("is forecast income minus total commitments", () => {
    const cap = computeCap({ forecastIncome: 5000, pots: [ratePot(500)], period });
    expect(cap).toBe(4500);
  });

  it("can go non-positive when commitments exceed forecast income", () => {
    const cap = computeCap({ forecastIncome: 400, pots: [ratePot(500)], period });
    expect(cap).toBe(-100);
  });
});
