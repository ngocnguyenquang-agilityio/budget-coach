import { describe, expect, it } from "vitest";
import { adjustmentReasonablenessScorer } from "./adjustment-reasonableness";

describe("adjustmentReasonablenessScorer", () => {
  it("scores 1 when every proposed limit is within 50% of spend", async () => {
    const result = await adjustmentReasonablenessScorer.run({
      input: { resourceId: "r1", threadId: "t1" },
      output: {
        resourceId: "r1",
        threadId: "t1",
        analysis: {
          categoryTotals: [{ category: "Dining", total: 100, overLimit: false }],
          expenseTotal: 100,
          incomeTotal: 0,
          netSavings: -100,
        },
        proposedLimits: { Dining: 110 },
      },
    });

    expect(result.score).toBe(1);
  });

  it("scores 0 when a proposed limit lands more than 50% away from spend", async () => {
    const result = await adjustmentReasonablenessScorer.run({
      input: { resourceId: "r1", threadId: "t1" },
      output: {
        resourceId: "r1",
        threadId: "t1",
        analysis: {
          categoryTotals: [{ category: "Dining", total: 100, overLimit: false }],
          expenseTotal: 100,
          incomeTotal: 0,
          netSavings: -100,
        },
        proposedLimits: { Dining: 200 },
      },
    });

    expect(result.score).toBe(0);
  });

  it("scores 0 for a category with net-negative spend when the proposed limit is way off", async () => {
    const result = await adjustmentReasonablenessScorer.run({
      input: { resourceId: "r1", threadId: "t1" },
      output: {
        resourceId: "r1",
        threadId: "t1",
        analysis: {
          categoryTotals: [{ category: "Dining", total: -10, overLimit: false }],
          expenseTotal: -10,
          incomeTotal: 0,
          netSavings: 10,
        },
        proposedLimits: { Dining: 500 },
      },
    });

    expect(result.score).toBe(0);
  });

  it("scores 0 when spend is zero but a nonzero limit is proposed", async () => {
    const result = await adjustmentReasonablenessScorer.run({
      input: { resourceId: "r1", threadId: "t1" },
      output: {
        resourceId: "r1",
        threadId: "t1",
        analysis: {
          categoryTotals: [{ category: "Dining", total: 0, overLimit: false }],
          expenseTotal: 0,
          incomeTotal: 0,
          netSavings: 0,
        },
        proposedLimits: { Dining: 50 },
      },
    });

    expect(result.score).toBe(0);
  });
});
