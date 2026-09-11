import { describe, expect, it } from "vitest";
import { BudgetStateSchema, parseAmendments, savingsBalance, type BudgetState } from "../budget-state";
import type { SavingsPot } from "../savings-pot";

const ratePot = (balance: number): SavingsPot => ({
  id: "p1",
  kind: "rate",
  name: "General savings",
  ratePerMonth: 500,
  balance,
});

describe("savingsBalance", () => {
  it("is zero for an empty state", () => {
    expect(savingsBalance({})).toBe(0);
  });

  it("is unallocated alone when there are no pots", () => {
    const state: BudgetState = { unallocated: 250 };
    expect(savingsBalance(state)).toBe(250);
  });

  it("sums every pot's balance plus unallocated", () => {
    const state: BudgetState = { unallocated: 100, savingsPots: [ratePot(300), ratePot(50)] };
    expect(savingsBalance(state)).toBe(450);
  });

  // unallocated may go negative when a Period is overspent; it is never
  // clawed back from pots to cover it.
  it("allows a negative unallocated to offset pot balances", () => {
    const state: BudgetState = { unallocated: -100, savingsPots: [ratePot(300)] };
    expect(savingsBalance(state)).toBe(200);
  });

  it("rounds to two decimal places", () => {
    const state: BudgetState = { unallocated: 0.1, savingsPots: [ratePot(0.2)] };
    expect(savingsBalance(state)).toBe(0.3);
  });
});

describe("BudgetStateSchema pendingAmendments", () => {
  it("accepts state with pendingAmendments set", () => {
    const parsed = BudgetStateSchema.safeParse({
      unallocated: 200,
      pendingAmendments: [{ period: "2026-07", netSavingsAtClose: 500 }],
    });
    expect(parsed.success).toBe(true);
  });

  // Load-bearing: a resource written before ADR-0015 has no pendingAmendments
  // field at all, and must not fail validation because of it.
  it("still parses a legacy state without pendingAmendments", () => {
    const parsed = BudgetStateSchema.safeParse({ unallocated: 200, savingsPots: [] });
    expect(parsed.success).toBe(true);
  });
});

describe("parseAmendments", () => {
  it("returns entries from a well-formed array", () => {
    const value = [{ period: "2026-07", netSavingsAtClose: 500 }];
    expect(parseAmendments(value)).toEqual(value);
  });

  it("drops malformed entries rather than throwing", () => {
    expect(parseAmendments([{ period: "2026-07" }, { period: "2026-08", netSavingsAtClose: 50 }])).toEqual([
      { period: "2026-08", netSavingsAtClose: 50 },
    ]);
  });

  it("returns an empty array for a non-array value", () => {
    expect(parseAmendments(undefined)).toEqual([]);
    expect(parseAmendments("not an array")).toEqual([]);
  });
});
