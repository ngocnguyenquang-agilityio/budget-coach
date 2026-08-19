import { describe, expect, it } from "vitest";
import { proposeCategoryLimits } from "./propose-limits";

describe("proposeCategoryLimits", () => {
  it("proposes 110% of spend per category", () => {
    const result = proposeCategoryLimits({
      categoryTotals: [
        { category: "Dining", total: 117.65, overLimit: false },
        { category: "Shopping", total: 200, overLimit: false },
      ],
      expenseTotal: 317.65,
      incomeTotal: 0,
      netSavings: -317.65,
    });

    expect(result).toEqual({ Dining: 129.42, Shopping: 220 });
  });

  it("returns an empty object when there is no spend to propose limits from", () => {
    expect(
      proposeCategoryLimits({ categoryTotals: [], expenseTotal: 0, incomeTotal: 0, netSavings: 0 })
    ).toEqual({});
  });

  it("uses the same formula regardless of whether limits already exist", () => {
    const analysis = {
      categoryTotals: [{ category: "Groceries" as const, total: 100, overLimit: true }],
      expenseTotal: 100,
      incomeTotal: 0,
      netSavings: -100,
    };

    expect(proposeCategoryLimits(analysis)).toEqual({ Groceries: 110 });
  });
});
