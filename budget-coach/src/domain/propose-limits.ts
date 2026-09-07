import type { AnalysisResult } from "./analysis";
import type { Category } from "./categories";

// Scales a set of Category Limits down proportionally so their sum fits within
// `cap`, leaving them untouched when already under it. Shared by both the
// Monthly Review (proposeCategoryLimits below) and the Goal Funding Plan
// (computeFundingPlan) — the one scaling primitive per ADR-0008; the two
// workflows' steps stay separate.
export const scaleLimitsToCap = (
  limits: Partial<Record<Category, number>>,
  cap: number
): Partial<Record<Category, number>> => {
  const sum = Object.values(limits).reduce((total, value) => total + (value ?? 0), 0);
  if (sum <= cap || sum === 0) return { ...limits };

  const scale = cap / sum;
  const scaled: Partial<Record<Category, number>> = {};
  for (const category of Object.keys(limits) as Category[]) {
    scaled[category] = Math.round(limits[category]! * scale * 100) / 100;
  }
  return scaled;
};

// One formula for both the first-ever Monthly Review (no prior
// categoryLimits) and every later adjustment — the Monthly Review workflow's
// proposeAdjustments step calls this unconditionally rather than branching on
// whether limits already exist, per the "same code path" requirement.
//
// cap (Declared Income − Savings Goal, per ADR-0007) only ever scales the
// proposal down when the sum would exceed it — never up. Leftover headroom
// below the cap isn't a limits problem; it just shows up as extra Net
// Savings, so an under-cap sum is left untouched.
export const proposeCategoryLimits = (
  analysis: AnalysisResult,
  cap?: number
): Partial<Record<Category, number>> => {
  const proposed: Partial<Record<Category, number>> = {};

  for (const { category, total } of analysis.categoryTotals) {
    proposed[category] = Math.round(total * 1.1 * 100) / 100;
  }

  if (cap === undefined) return proposed;

  // Refuse rather than produce negative or degenerate limits — per ADR-0007,
  // an unworkable cap (Savings Goal >= Declared Income) is the caller's job
  // to catch and flag to the user before ever reaching this function.
  if (cap <= 0) {
    throw new Error("Category limits cannot be proposed: cap (Declared Income − Savings Goal) is not positive.");
  }

  return scaleLimitsToCap(proposed, cap);
};
