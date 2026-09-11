import { Agent } from "@mastra/core/agent";
import { model } from "@/mastra/config/model";
import { createCerebrasRetryProcessor } from "@/mastra/config/error-processors";
import { SUGGESTER_INSTRUCTIONS } from "@/constants/suggester-instructions";

// Backs the dashboard's dynamic "after-first-message" suggestion chips
// (useConfigureSuggestions with providerAgentId: "suggester"). Deliberately has
// no memory: the suggestion engine seeds this agent with the Coach's messages
// and state on every run, so it needs none of its own — and, crucially, a
// memoryless agent never persists a thread. Pointing suggestions at the Coach
// (which carries Memory) instead made every suggestion run save its throwaway
// suggestionId thread to LibSQL, flooding the conversation sidebar. No tools or
// guardrails either: the engine injects and forces the `copilotkitSuggest` tool
// itself, and the Coach's output guardrails would only interfere with it.
export const suggesterAgent = new Agent({
  id: "suggester",
  name: "Suggester",
  model,
  instructions: SUGGESTER_INSTRUCTIONS,
  // Cerebras's free tier caps at 5 requests/minute; retry transient 429s
  // with backoff instead of surfacing them to the user.
  errorProcessors: [createCerebrasRetryProcessor()],
});
