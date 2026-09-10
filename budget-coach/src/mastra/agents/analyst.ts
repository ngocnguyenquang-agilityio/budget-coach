import { Agent } from "@mastra/core/agent";
import { StreamErrorRetryProcessor } from "@mastra/core/processors";
import { model } from "@/mastra/config/model";
import { analyzeTransactionsTool } from "@/mastra/tools/analyze-transactions";
import { ANALYST_INSTRUCTIONS } from "@/constants/analyst-instructions";

// Read-only spending analyzer: calls analyzeTransactions and relays its result verbatim.
export const analystAgent = new Agent({
  id: "analyst",
  name: "Analyst",
  model,
  tools: { analyzeTransactions: analyzeTransactionsTool },
  instructions: ANALYST_INSTRUCTIONS,
  // Cerebras's free tier caps at 5 requests/minute; retry transient 429s
  // with backoff instead of surfacing them to the user.
  errorProcessors: [
    new StreamErrorRetryProcessor({
      retryUnknownErrors: true,
      maxRetries: 2,
      delayMs: ({ retryCount }) => Math.min(4000 * 2 ** retryCount, 20000),
    }),
  ],
});
