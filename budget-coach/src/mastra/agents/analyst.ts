import { Agent } from "@mastra/core/agent";
import { model } from "@/mastra/config/model";
import { createCerebrasRetryProcessor } from "@/mastra/config/error-processors";
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
  errorProcessors: [createCerebrasRetryProcessor()],
});
