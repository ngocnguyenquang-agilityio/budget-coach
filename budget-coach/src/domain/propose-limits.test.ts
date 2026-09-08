import { describe, expect, it } from "vitest";
import { proposeCategoryLimits } from "./propose-limits";
import type { AnalysisResult } from "./analysis";

const analysis = (
  categoryTotals: AnalysisResult["categoryTotals"],
  overrides: Partial<AnalysisResult> = {}
): AnalysisResult => ({
  categoryTotals,
  expenseTotal: categoryTotals.reduce((sum, entry) => sum + entry.spent, 0),
  committedExpenseTotal: categoryTotals.reduce((sum, entry) => sum + entry.committed, 0),
  receivedIncome: 0,
  forecastIncome: 0,
  netSavings: 0,
  ...overrides,
});

const total = (
  category: AnalysisResult["categoryTotals"][number]["category"],
  spent: number,
  committed = spent
) => ({ category, spent, committed, overLimit: false, onTrackToExceed: false });

describe("proposeCategoryLimits", () => {
  it("proposes 110% of spend per category", () => {
    const result = proposeCategoryLimits(
      analysis([total("Dining", 117.65), total("Shopping", 200)])
    );

    expect(result).toEqual({ Dining: 129.42, Shopping: 220 });
  });

  it("returns an empty object when there is no spend to propose limits from", () => {
    expect(proposeCategoryLimits(analysis([]))).toEqual({});
  });

  it("uses the same formula regardless of whether limits already exist", () => {
    expect(proposeCategoryLimits(analysis([total("Groceries", 100)]))).toEqual({ Groceries: 110 });
  });

  // ADR-0011: proportions come from what actually happened, not from a
  // forecast — an expected expense is not yet a habit.
  it("proposes from received spend, ignoring the still-expected portion", () => {
    expect(proposeCategoryLimits(analysis([total("Housing", 200, 1100)]))).toEqual({ Housing: 220 });
  });

  it("scales the proposal down to fit the cap, never up", () => {
    const under = proposeCategoryLimits(analysis([total("Dining", 100)]), 1000);
    expect(under).toEqual({ Dining: 110 });

    const over = proposeCategoryLimits(
      analysis([total("Dining", 100), total("Shopping", 100)]),
      110
    );
    expect(over).toEqual({ Dining: 55, Shopping: 55 });
  });

  // ADR-0014: a non-positive cap means the caller should have refused the
  // Commitment that produced it.
  it("throws rather than produce degenerate limits from a non-positive cap", () => {
    expect(() => proposeCategoryLimits(analysis([total("Dining", 100)]), 0)).toThrow(/not positive/);
  });
});
