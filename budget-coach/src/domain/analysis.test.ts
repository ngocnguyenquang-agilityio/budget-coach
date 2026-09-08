import { describe, expect, it } from "vitest";
import { computeAnalysis, type AnalyzableTransaction } from "./analysis";

const PERIOD = "2026-03";

const dateInPeriod = (day: number): string => `${PERIOD}-${String(day).padStart(2, "0")}`;
const dateOutsidePeriod = "2026-02-15";

const received = (transaction: Omit<AnalyzableTransaction, "status">): AnalyzableTransaction => ({
  ...transaction,
  status: "received",
});

const expected = (transaction: Omit<AnalyzableTransaction, "status">): AnalyzableTransaction => ({
  ...transaction,
  status: "expected",
});

describe("computeAnalysis", () => {
  it("sums amounts per category exactly, excluding income", () => {
    const result = computeAnalysis(
      [
        received({ type: "expense", category: "Dining", amount: 14.5, date: dateInPeriod(1) }),
        received({ type: "expense", category: "Dining", amount: 6.75, date: dateInPeriod(2) }),
        received({ type: "expense", category: "Dining", amount: 96.4, date: dateInPeriod(3) }),
        received({ type: "income", amount: 3200, date: dateInPeriod(1) }),
      ],
      {},
      PERIOD
    );

    expect(result.categoryTotals).toEqual([
      { category: "Dining", spent: 117.65, committed: 117.65, overLimit: false, onTrackToExceed: false },
    ]);
    expect(result.expenseTotal).toBeCloseTo(117.65);
    expect(result.receivedIncome).toBeCloseTo(3200);
    expect(result.forecastIncome).toBeCloseTo(3200);
  });

  it("excludes transactions outside the current period", () => {
    const result = computeAnalysis(
      [
        received({ type: "expense", category: "Shopping", amount: 100, date: dateInPeriod(10) }),
        received({ type: "expense", category: "Shopping", amount: 50, date: dateOutsidePeriod }),
      ],
      {},
      PERIOD
    );

    expect(result.categoryTotals).toEqual([
      { category: "Shopping", spent: 100, committed: 100, overLimit: false, onTrackToExceed: false },
    ]);
  });

  it("flags overLimit when received spend exceeds the limit", () => {
    const result = computeAnalysis(
      [
        received({ type: "expense", category: "Shopping", amount: 200, date: dateInPeriod(1) }),
        received({ type: "expense", category: "Groceries", amount: 50, date: dateInPeriod(1) }),
      ],
      { Shopping: 150, Groceries: 100 },
      PERIOD
    );

    expect(result.categoryTotals).toEqual([
      { category: "Shopping", spent: 200, committed: 200, overLimit: true, onTrackToExceed: false },
      { category: "Groceries", spent: 50, committed: 50, overLimit: false, onTrackToExceed: false },
    ]);
  });

  // ADR-0011: only received rows count toward the over-limit flag; an
  // expected row that would push the category over raises the softer
  // "on track to exceed" warning instead.
  it("counts an expected expense toward committed but not spent", () => {
    const result = computeAnalysis(
      [
        received({ type: "expense", category: "Housing", amount: 200, date: dateInPeriod(1) }),
        expected({ type: "expense", category: "Housing", amount: 900, date: dateInPeriod(28) }),
      ],
      { Housing: 1000 },
      PERIOD
    );

    expect(result.categoryTotals).toEqual([
      { category: "Housing", spent: 200, committed: 1100, overLimit: false, onTrackToExceed: true },
    ]);
    expect(result.expenseTotal).toBeCloseTo(200);
    expect(result.committedExpenseTotal).toBeCloseTo(1100);
  });

  it("separates received income from forecast income", () => {
    const result = computeAnalysis(
      [
        received({ type: "income", amount: 1500, date: dateInPeriod(1) }),
        expected({ type: "income", amount: 1700, date: dateInPeriod(25) }),
      ],
      {},
      PERIOD
    );

    expect(result.receivedIncome).toBeCloseTo(1500);
    expect(result.forecastIncome).toBeCloseTo(3200);
    // Net savings is realized, so it uses received income only.
    expect(result.netSavings).toBeCloseTo(1500);
  });

  it("computes netSavings as received income minus received expenses", () => {
    const result = computeAnalysis(
      [
        received({ type: "income", amount: 3200, date: dateInPeriod(1) }),
        received({ type: "income", amount: 450, date: dateInPeriod(10) }),
        received({ type: "expense", category: "Housing", amount: 1850, date: dateInPeriod(5) }),
        received({ type: "expense", category: "Groceries", amount: 300, date: dateInPeriod(6) }),
      ],
      {},
      PERIOD
    );

    expect(result.receivedIncome).toBeCloseTo(3650);
    expect(result.expenseTotal).toBeCloseTo(2150);
    expect(result.netSavings).toBeCloseTo(1500);
  });

  // ADR-0012: the money was saved in an earlier Period and already sits in
  // the Savings Balance — counting it here would debit the Balance twice and
  // show the purchase month as a crater.
  it("excludes a pot-funded expense from netSavings but not from its category", () => {
    const result = computeAnalysis(
      [
        received({ type: "income", amount: 3000, date: dateInPeriod(1) }),
        received({ type: "expense", category: "Groceries", amount: 400, date: dateInPeriod(5) }),
        received({
          type: "expense",
          category: "Shopping",
          amount: 1200,
          date: dateInPeriod(9),
          fundedByPotId: "pot-laptop",
        }),
      ],
      {},
      PERIOD
    );

    expect(result.expenseTotal).toBeCloseTo(1600);
    // 3000 − 400: the $1,200 laptop came out of savings, not this month.
    expect(result.netSavings).toBeCloseTo(2600);
    expect(result.categoryTotals.find((entry) => entry.category === "Shopping")?.spent).toBe(1200);
  });

  it("carries no category and never appears in categoryTotals for income", () => {
    const result = computeAnalysis(
      [received({ type: "income", amount: 3200, date: dateInPeriod(1) })],
      {},
      PERIOD
    );

    expect(result.categoryTotals).toEqual([]);
    expect(result.receivedIncome).toBeCloseTo(3200);
  });
});
