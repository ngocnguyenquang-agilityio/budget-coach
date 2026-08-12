import { describe, expect, it } from "vitest";
import { computeAnalysis } from "./analysis";

const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

describe("computeAnalysis", () => {
  it("sums amounts per category exactly, excluding Income", () => {
    const result = computeAnalysis(
      [
        { category: "Dining", amount: 14.5, date: daysAgo(1) },
        { category: "Dining", amount: 6.75, date: daysAgo(2) },
        { category: "Dining", amount: 96.4, date: daysAgo(3) },
        { category: "Income", amount: 3200, date: daysAgo(1) },
      ],
      {}
    );

    expect(result.categoryTotals).toEqual([{ category: "Dining", total: 117.65, overLimit: false }]);
    expect(result.trailingSpend).toBeCloseTo(117.65);
  });

  it("excludes transactions older than the trailing 30 days", () => {
    const result = computeAnalysis(
      [
        { category: "Shopping", amount: 100, date: daysAgo(10) },
        { category: "Shopping", amount: 50, date: daysAgo(45) },
      ],
      {}
    );

    expect(result.categoryTotals).toEqual([{ category: "Shopping", total: 100, overLimit: false }]);
  });

  it("flags overLimit when the category total exceeds its limit", () => {
    const result = computeAnalysis(
      [
        { category: "Shopping", amount: 200, date: daysAgo(1) },
        { category: "Groceries", amount: 50, date: daysAgo(1) },
      ],
      { Shopping: 150, Groceries: 100 }
    );

    expect(result.categoryTotals).toEqual([
      { category: "Shopping", total: 200, overLimit: true },
      { category: "Groceries", total: 50, overLimit: false },
    ]);
  });
});
