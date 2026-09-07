import { describe, expect, it } from "vitest";
import { computeFundingPlan, monthDiff } from "./funding-plan";

describe("monthDiff", () => {
  it("counts whole months forward", () => {
    expect(monthDiff("2026-09", "2026-12")).toBe(3);
    expect(monthDiff("2026-09", "2027-03")).toBe(6);
  });

  it("is negative when the target precedes the period", () => {
    expect(monthDiff("2026-09", "2026-08")).toBe(-1);
  });
});

describe("computeFundingPlan", () => {
  const period = "2026-09";

  it("divides a dated savings target across the months remaining (inclusive)", () => {
    // $2,000 by December, from September → Sep, Oct, Nov, Dec = 4 months.
    const plan = computeFundingPlan({
      declaredIncome: 4000,
      categoryLimits: { Groceries: 500 },
      target: { amount: 2000, deadline: "2026-12", kind: "savings" },
      period,
    });
    expect(plan.requiredPerMonth).toBe(500);
  });

  it("treats an undated target as due this period (full amount)", () => {
    const plan = computeFundingPlan({
      declaredIncome: 4000,
      categoryLimits: {},
      target: { amount: 500, kind: "savings" },
      period,
    });
    expect(plan.requiredPerMonth).toBe(500);
  });

  it("returns 'infeasible' when required/month meets or exceeds declared income", () => {
    const plan = computeFundingPlan({
      declaredIncome: 4000,
      categoryLimits: { Groceries: 1000 },
      target: { amount: 5000, kind: "savings" },
      period,
    });
    expect(plan.outcome).toBe("infeasible");
    if (plan.outcome === "infeasible") {
      expect(plan.requiredPerMonth).toBe(5000);
      expect(plan.declaredIncome).toBe(4000);
    }
  });

  it("returns 'fits' when capacity already covers required/month (savings, no cuts)", () => {
    // capacity = 4000 − 3000 = 1000 ≥ 500 required.
    const plan = computeFundingPlan({
      declaredIncome: 4000,
      categoryLimits: { Groceries: 1000, Dining: 1000, Shopping: 1000 },
      target: { amount: 500, kind: "savings" },
      period,
    });
    expect(plan.outcome).toBe("fits");
    if (plan.outcome === "fits") {
      expect(plan.capacity).toBe(1000);
      expect(plan.requiredPerMonth).toBe(500);
    }
  });

  it("returns 'fits' for a purchase already within capacity", () => {
    // capacity = 4000 − 2000 = 2000 ≥ 1200.
    const plan = computeFundingPlan({
      declaredIncome: 4000,
      categoryLimits: { Groceries: 1000, Dining: 1000 },
      target: { amount: 1200, kind: "purchase" },
      period,
    });
    expect(plan.outcome).toBe("fits");
  });

  it("returns 'cuts' scaling limits proportionally under the tighter cap", () => {
    // required = 2000/4 = 500; capacity = 4000 − 3800 = 200 < 500 → cuts.
    // cap = 4000 − 500 = 3500; limits sum 3800 scaled by 3500/3800.
    const plan = computeFundingPlan({
      declaredIncome: 4000,
      categoryLimits: { Groceries: 1900, Dining: 1900 },
      target: { amount: 2000, deadline: "2026-12", kind: "savings" },
      period,
    });
    expect(plan.outcome).toBe("cuts");
    if (plan.outcome === "cuts") {
      expect(plan.cap).toBe(3500);
      const total = Object.values(plan.proposedLimits).reduce((sum, value) => sum + (value ?? 0), 0);
      expect(total).toBeCloseTo(3500, 1);
      expect(plan.proposedLimits.Groceries).toBeCloseTo(1750, 1);
    }
  });

  it("distributes a dated purchase set-aside across months", () => {
    // $1,200 over Sep, Oct, Nov = 3 months → 400/mo. capacity 100 < 400 → cuts.
    const plan = computeFundingPlan({
      declaredIncome: 4000,
      categoryLimits: { Groceries: 3900 },
      target: { amount: 1200, deadline: "2026-11", kind: "purchase" },
      period,
    });
    expect(plan.requiredPerMonth).toBe(400);
    expect(plan.outcome).toBe("cuts");
  });
});
