import type { AnalysisResult } from "./analysis";
import type { Category } from "./categories";

// One formula for both the first-ever Monthly Review (no prior
// categoryLimits) and every later adjustment — the Monthly Review workflow's
// proposeAdjustments step calls this unconditionally rather than branching on
// whether limits already exist, per the "same code path" requirement.
export function proposeCategoryLimits(analysis: AnalysisResult): Partial<Record<Category, number>> {
  const proposed: Partial<Record<Category, number>> = {};

  for (const { category, total } of analysis.categoryTotals) {
    proposed[category] = Math.round(total * 1.1 * 100) / 100;
  }

  return proposed;
}
