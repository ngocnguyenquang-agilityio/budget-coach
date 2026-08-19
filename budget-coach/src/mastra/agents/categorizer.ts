import { Agent } from "@mastra/core/agent";
import { StreamErrorRetryProcessor } from "@mastra/core/processors";
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
  instructions: `You classify a single transaction.

First decide whether it is income (money coming in, e.g. salary, bonus, freelance payment, proceeds from selling something) or an expense (money going out).

If it is an expense, also assign exactly one category from this list: ${CATEGORIES.join(", ")}. Never invent a category outside this list. If it is income, do not assign a category.

Given a merchant name and an amount, respond with your best judgment.`,
  // Cerebras's free tier caps at 5 requests/minute; retry transient 429s
  // with backoff instead of surfacing them to the user.
  errorProcessors: [
    new StreamErrorRetryProcessor({
      retryUnknownErrors: true,
      maxRetries: 2,
      delayMs: ({ retryCount }) => Math.min(4000 * 2 ** retryCount, 20000),
    }),
  ],
  scorers: {
    categorizerAccuracy: {
      scorer: categorizerAccuracyScorer,
      sampling: { type: "ratio", rate: 1 },
    },
  },
});
