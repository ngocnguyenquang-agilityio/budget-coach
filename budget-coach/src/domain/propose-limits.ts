import type { AnalysisResult } from "./analysis";
import type { Category } from "./categories";

// Scales a set of Category Limits down proportionally so their sum fits within
// `cap`, leaving them untouched when already under it. Shared by the Monthly
// Review (proposeCategoryLimits below) and the refit (computeRefit) — the one
// scaling primitive; what changed under ADR-0014 is that both now receive the
// *same* cap rather than each deriving one.
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
// whether limits already exist.
//
// Proportions come from trailing *received* spend (ADR-0011): an expected
// expense is a forecast, not a habit, and shouldn't shape next month's
// allowances.
//
// The cap (Forecast Income − Commitments, per ADR-0014) only ever scales the
// proposal down — never up. Leftover headroom below the cap isn't a limits
// problem; it just shows up as extra Net Savings.
export const proposeCategoryLimits = (
  analysis: AnalysisResult,
  cap?: number
): Partial<Record<Category, number>> => {
  const proposed: Partial<Record<Category, number>> = {};

  for (const { category, spent } of analysis.categoryTotals) {
    proposed[category] = Math.round(spent * 1.1 * 100) / 100;
  }

  if (cap === undefined) return proposed;

  // Refuse rather than produce negative or degenerate limits — per ADR-0014,
  // a non-positive Cap means the caller should have refused the Commitment
  // that produced it before ever reaching this function.
  if (cap <= 0) {
    throw new Error("Category limits cannot be proposed: cap (Forecast Income − Commitments) is not positive.");
  }

  return scaleLimitsToCap(proposed, cap);
};
