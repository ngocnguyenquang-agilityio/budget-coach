import { Agent } from "@mastra/core/agent";
import { model } from "@/mastra/config/model";
import { createCerebrasRetryProcessor } from "@/mastra/config/error-processors";
import { TRANSACTION_EXTRACTOR_INSTRUCTIONS } from "@/constants/transaction-extractor-instructions";

// Narrow and stateless by design: no tools, no memory. Called by the Coach's
// "extractTransactions" tool (src/mastra/tools/extract-transactions.ts) with
// structured output forcing the reply into a { merchant, amount, date? } list —
// moving the message split out of the Coach's inline prose (unreliable on the
// weak model) into a focused, schema-forced pass.
export const transactionExtractorAgent = new Agent({
  id: "transaction-extractor",
  name: "Transaction Extractor",
  model,
  instructions: TRANSACTION_EXTRACTOR_INSTRUCTIONS,
  // Cerebras's free tier caps at 5 requests/minute; retry transient 429s
  // with backoff instead of surfacing them to the user.
  errorProcessors: [createCerebrasRetryProcessor()],
});
