import { Agent } from "@mastra/core/agent";
import { StreamErrorRetryProcessor } from "@mastra/core/processors";
import { model } from "@/mastra/model";
import { analyzeTransactionsTool } from "@/mastra/tools/analyze-transactions";

// Read-only spending analyzer: calls analyzeTransactions and relays its result verbatim.
export const analystAgent = new Agent({
  id: "analyst",
  name: "Analyst",
  model,
  tools: { analyzeTransactions: analyzeTransactionsTool },
  instructions: `You analyze a user's spending.

Call the analyzeTransactions tool with the given category limits, then report its result exactly as returned — do not recompute or re-add any figures yourself.`,
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
