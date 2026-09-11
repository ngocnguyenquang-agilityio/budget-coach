import { Agent } from "@mastra/core/agent";
import { model } from "@/mastra/config/model";
import { createCerebrasRetryProcessor } from "@/mastra/config/error-processors";
import { CATEGORIES } from "@/domain/categories";
import { categorizerAccuracyScorer } from "@/mastra/scorers/categorizer-accuracy";
import { buildCategorizerInstructions } from "@/constants/categorizer-instructions";

// Narrow and stateless by design: no tools, no memory. Called by the Coach's
// "categorize" tool (src/mastra/tools/categorize.ts) with structured output
// forcing the reply into one of CATEGORIES.
export const categorizerAgent = new Agent({
  id: "categorizer",
  name: "Categorizer",
  model,
  instructions: buildCategorizerInstructions(CATEGORIES),
  // Cerebras's free tier caps at 5 requests/minute; retry transient 429s
  // with backoff instead of surfacing them to the user.
  errorProcessors: [createCerebrasRetryProcessor()],
  scorers: {
    categorizerAccuracy: {
      scorer: categorizerAccuracyScorer,
      sampling: { type: "ratio", rate: 1 },
    },
  },
});
