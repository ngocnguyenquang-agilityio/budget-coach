import { describe, expect, it } from "vitest";
import { computeAnalysis } from "./analysis";

const PERIOD = "2026-03";

const dateInPeriod = (day: number): string => `${PERIOD}-${String(day).padStart(2, "0")}`;
const dateOutsidePeriod = "2026-02-15";

describe("computeAnalysis", () => {
  it("sums amounts per category exactly, excluding income", () => {
    const result = computeAnalysis(
      [
        { type: "expense", category: "Dining", amount: 14.5, date: dateInPeriod(1) },
        { type: "expense", category: "Dining", amount: 6.75, date: dateInPeriod(2) },
        { type: "expense", category: "Dining", amount: 96.4, date: dateInPeriod(3) },
        { type: "income", amount: 3200, date: dateInPeriod(1) },
      ],
      {},
      PERIOD
    );

    expect(result.categoryTotals).toEqual([{ category: "Dining", total: 117.65, overLimit: false }]);
    expect(result.expenseTotal).toBeCloseTo(117.65);
    expect(result.incomeTotal).toBeCloseTo(3200);
  });

  it("excludes transactions outside the current period", () => {
    const result = computeAnalysis(
      [
        { type: "expense", category: "Shopping", amount: 100, date: dateInPeriod(10) },
        { type: "expense", category: "Shopping", amount: 50, date: dateOutsidePeriod },
      ],
      {},
      PERIOD
    );

    expect(result.categoryTotals).toEqual([{ category: "Shopping", total: 100, overLimit: false }]);
  });

  it("flags overLimit when the category total exceeds its limit", () => {
    const result = computeAnalysis(
      [
        { type: "expense", category: "Shopping", amount: 200, date: dateInPeriod(1) },
        { type: "expense", category: "Groceries", amount: 50, date: dateInPeriod(1) },
      ],
      { Shopping: 150, Groceries: 100 },
      PERIOD
    );

    expect(result.categoryTotals).toEqual([
      { category: "Shopping", total: 200, overLimit: true },
      { category: "Groceries", total: 50, overLimit: false },
    ]);
  });

  it("computes netSavings as income minus expenses for the period", () => {
    const result = computeAnalysis(
      [
        { type: "income", amount: 3200, date: dateInPeriod(1) },
        { type: "income", amount: 450, date: dateInPeriod(10) },
        { type: "expense", category: "Housing", amount: 1850, date: dateInPeriod(5) },
        { type: "expense", category: "Groceries", amount: 300, date: dateInPeriod(6) },
      ],
      {},
      PERIOD
    );

    expect(result.incomeTotal).toBeCloseTo(3650);
    expect(result.expenseTotal).toBeCloseTo(2150);
    expect(result.netSavings).toBeCloseTo(1500);
  });

  it("carries no category and never appears in categoryTotals for income", () => {
    const result = computeAnalysis(
      [{ type: "income", amount: 3200, date: dateInPeriod(1) }],
      {},
      PERIOD
    );

    expect(result.categoryTotals).toEqual([]);
    expect(result.incomeTotal).toBeCloseTo(3200);
  });
});
