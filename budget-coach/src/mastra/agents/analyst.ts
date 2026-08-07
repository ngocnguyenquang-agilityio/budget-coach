import { Agent } from "@mastra/core/agent";
import { model } from "@/mastra/model";
import { analyzeTransactionsTool } from "@/mastra/tools/analyze-transactions";

// Read-only by design: the only tool it has is analyze-transactions, no
// memory. Called by the Coach's "analyze spending" tool
// (src/mastra/tools/analyze-spending.ts), which threads resourceId through
// requestContext and category limits through the prompt.
//
// The tool does the per-category arithmetic in code (see
// src/domain/analysis.ts) rather than leaving it to the model — local models
// (e.g. llama3.1 via Ollama) reliably mis-add totals across more than a
// couple of transactions. The Analyst's job is just to call the tool with
// the given limits and relay its (already-correct) result.
export const analystAgent = new Agent({
  id: "analyst",
  name: "Analyst",
  model,
  tools: { analyzeTransactions: analyzeTransactionsTool },
  instructions: `You analyze a user's spending.

Call the analyzeTransactions tool with the given category limits, then report its result exactly as returned — do not recompute or re-add any figures yourself.`,
});
