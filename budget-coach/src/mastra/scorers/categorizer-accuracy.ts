import { createScorer } from "@mastra/core/evals";
import { CATEGORIES, type Category } from "@/domain/categories";
import { getAssistantText } from "./message-text";

// Purely deterministic (no judge): finds which category name the
// Categorizer's structured-output response contains, then compares it
// against seed ground truth. Live traffic has no ground truth to check
// against, so it scores 1 rather than treating "unknown" as a failure.
export const categorizerAccuracyScorer = createScorer({
  id: "categorizer-accuracy",
  description: "Compares the Categorizer's assigned category against seedCategory ground truth, when available.",
  type: "agent",
})
  .analyze(({ run }) => {
    const text = getAssistantText(run.output);
    const assigned = CATEGORIES.find((category) => text.includes(category));
    const groundTruth = typeof run.groundTruth === "string" ? (run.groundTruth as Category) : undefined;

    return { assigned, groundTruth };
  })
  .generateScore(({ results }) => {
    const { assigned, groundTruth } = results.analyzeStepResult;
    if (!groundTruth) return 1;
    return assigned === groundTruth ? 1 : 0;
  })
  .generateReason(({ results, score }) => {
    const { assigned, groundTruth } = results.analyzeStepResult;
    if (!groundTruth) return `Score: ${score}. No ground truth category to compare against.`;
    return `Score: ${score}. Assigned "${assigned ?? "unknown"}", expected "${groundTruth}".`;
  });
