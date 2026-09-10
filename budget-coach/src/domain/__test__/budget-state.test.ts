import { describe, expect, it } from "vitest";
import { savingsBalance, type BudgetState } from "../budget-state";
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
