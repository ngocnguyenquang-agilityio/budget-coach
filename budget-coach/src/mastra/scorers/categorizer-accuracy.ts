import { createScorer } from "@mastra/core/evals";
import { CATEGORIES, type Category } from "@/domain/categories";
import { getAssistantText } from "./message-text";

// "Income" is a ground-truth sentinel (not a Category value, since Income
// was removed from the Category enum) meaning "this transaction should be
// classified as income."
type GroundTruth = Category | "Income";

// Purely deterministic (no judge): finds which type/category the
// Categorizer's structured-output response contains, then compares it
// against seed ground truth. Live traffic has no ground truth to check
// against, so it scores 1 rather than treating "unknown" as a failure.
export const categorizerAccuracyScorer = createScorer({
  id: "categorizer-accuracy",
  description: "Compares the Categorizer's assigned type/category against seedCategory ground truth, when available.",
  type: "agent",
})
  .analyze(({ run }) => {
    const text = getAssistantText(run.output);
    const assignedType = text.includes('"income"') ? ("income" as const) : ("expense" as const);
    const assignedCategory = CATEGORIES.find((category) => text.includes(category));
    const groundTruth = typeof run.groundTruth === "string" ? (run.groundTruth as GroundTruth) : undefined;

    return { assignedType, assignedCategory, groundTruth };
  })
  .generateScore(({ results }) => {
    const { assignedType, assignedCategory, groundTruth } = results.analyzeStepResult;
    if (!groundTruth) return 1;
    if (groundTruth === "Income") return assignedType === "income" ? 1 : 0;
    return assignedType === "expense" && assignedCategory === groundTruth ? 1 : 0;
  })
  .generateReason(({ results, score }) => {
    const { assignedType, assignedCategory, groundTruth } = results.analyzeStepResult;
    if (!groundTruth) return `Score: ${score}. No ground truth to compare against.`;
    const assigned = assignedType === "income" ? "Income" : (assignedCategory ?? "unknown");
    return `Score: ${score}. Assigned "${assigned}", expected "${groundTruth}".`;
  });
