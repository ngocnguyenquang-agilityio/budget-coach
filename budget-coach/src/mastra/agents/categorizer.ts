import { Agent } from "@mastra/core/agent";
import { model } from "@/mastra/model";
import { CATEGORIES } from "@/domain/categories";
import { categorizerAccuracyScorer } from "@/mastra/scorers/categorizer-accuracy";

// Narrow and stateless by design: no tools, no memory. Called by the Coach's
// "categorize" tool (src/mastra/tools/categorize.ts) with structured output
// forcing the reply into one of CATEGORIES.
export const categorizerAgent = new Agent({
  id: "categorizer",
  name: "Categorizer",
  model,
  instructions: `You classify a single transaction into exactly one category.

Valid categories: ${CATEGORIES.join(", ")}.

Given a merchant name and an amount, respond with the single best-fitting category from the list above. Never invent a category outside this list.`,
  scorers: {
    categorizerAccuracy: {
      scorer: categorizerAccuracyScorer,
      sampling: { type: "ratio", rate: 1 },
    },
  },
});
