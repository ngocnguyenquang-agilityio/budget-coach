import { z } from "zod";
import type { Category } from "./categories";
import { scaleLimitsToCap } from "./propose-limits";

// A one-off funding objective the User states in chat (see CONTEXT.md,
// "Target"). Never persisted as-is: a savings Target resolves into a Savings
// Goal; a purchase Target leaves only the re-fitted Category Limits behind.
export const TargetSchema = z.object({
  amount: z.number().positive(),
  // YYYY-MM. Absent means "this Period" — the whole amount is required now.
  deadline: z.string().optional(),
  kind: z.enum(["savings", "purchase"]),
});

export type Target = z.infer<typeof TargetSchema>;

type CategoryLimits = Partial<Record<Category, number>>;

// Whole-month distance between two YYYY-MM strings (toPeriod − fromPeriod).
// Negative when toPeriod precedes fromPeriod; callers clamp as needed.
export const monthDiff = (fromPeriod: string, toPeriod: string): number => {
  const [fromYear, fromMonth] = fromPeriod.split("-").map(Number);
  const [toYear, toMonth] = toPeriod.split("-").map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
};

// Discriminated on `outcome`:
// - "infeasible": required/month meets or exceeds Declared Income — can't set
//   aside more than you earn. The Funding Plan declines rather than proposing
//   limits (mirrors approveBudgetTool's "goal not achievable" guard).
// - "fits": current Capacity already covers required/month — no cuts needed.
// - "cuts": Capacity falls short — Category Limits are scaled down to fund the
//   Target under a tighter cap (Declared Income − required/month).
export type FundingPlan =
  | { outcome: "infeasible"; requiredPerMonth: number; declaredIncome: number }
  | { outcome: "fits"; requiredPerMonth: number; capacity: number }
  | {
      outcome: "cuts";
      requiredPerMonth: number;
      capacity: number;
      cap: number;
      proposedLimits: CategoryLimits;
    };

// Capacity = Declared Income − sum(Category Limits): the User's committed free
// cash (CONTEXT.md, "Capacity"), deliberately not trailing spend — Monthly
// Review owns "past spend → limits", the Funding Plan owns "committed limits →
// Target" (ADR-0008).
export const computeFundingPlan = ({
  declaredIncome,
  categoryLimits,
  target,
  period,
}: {
  declaredIncome: number;
  categoryLimits: CategoryLimits;
  target: Target;
  period: string;
}): FundingPlan => {
  const monthsRemaining = target.deadline
    ? Math.max(1, monthDiff(period, target.deadline) + 1)
    : 1;
  const requiredPerMonth = target.deadline
    ? Math.round((target.amount / monthsRemaining) * 100) / 100
    : target.amount;

  if (requiredPerMonth >= declaredIncome) {
    return { outcome: "infeasible", requiredPerMonth, declaredIncome };
  }

  const committed = Object.values(categoryLimits).reduce((total, value) => total + (value ?? 0), 0);
  const capacity = declaredIncome - committed;

  if (capacity >= requiredPerMonth) {
    return { outcome: "fits", requiredPerMonth, capacity };
  }

  const cap = declaredIncome - requiredPerMonth;
  return {
    outcome: "cuts",
    requiredPerMonth,
    capacity,
    cap,
    proposedLimits: scaleLimitsToCap(categoryLimits, cap),
  };
};
