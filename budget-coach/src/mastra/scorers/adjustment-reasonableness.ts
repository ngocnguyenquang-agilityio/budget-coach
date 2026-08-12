import { createScorer } from "@mastra/core/evals";
import type { z } from "zod";
import type { Category } from "@/domain/categories";
import type { reviewSchema } from "@/mastra/workflows/monthly-review-workflow";

type ReviewState = z.infer<typeof reviewSchema>;

// Attached to the Monthly Review workflow's proposeAdjustments step
// (src/mastra/workflows/monthly-review-workflow.ts). Deterministic: flags any
// proposed limit landing more than 50% away from that category's trailing
// spend, regardless of which formula produced it.
export const adjustmentReasonablenessScorer = createScorer<ReviewState, ReviewState>({
  id: "adjustment-reasonableness",
  description: "Flags proposed category limits that land more than 50% away from trailing spend for that category.",
})
  .analyze(({ run }) => {
    const proposedLimits = run.output.proposedLimits ?? {};
    const trailingByCategory = new Map(
      (run.output.analysis?.categoryTotals ?? []).map((entry) => [entry.category, entry.total])
    );

    const flaggedCategories = (Object.entries(proposedLimits) as [Category, number][])
      .filter(([category, limit]) => {
        const trailing = trailingByCategory.get(category);
        if (trailing === undefined) return false;
        if (trailing === 0) return limit !== 0;
        return Math.abs(limit - trailing) / Math.abs(trailing) > 0.5;
      })
      .map(([category]) => category);

    return { flaggedCategories };
  })
  .generateScore(({ results }) => (results.analyzeStepResult.flaggedCategories.length === 0 ? 1 : 0))
  .generateReason(({ results, score }) => {
    const { flaggedCategories } = results.analyzeStepResult;
    return flaggedCategories.length === 0
      ? `Score: ${score}. All proposed limits are within 50% of trailing spend.`
      : `Score: ${score}. Proposed limits more than 50% off trailing spend: ${flaggedCategories.join(", ")}.`;
  });
