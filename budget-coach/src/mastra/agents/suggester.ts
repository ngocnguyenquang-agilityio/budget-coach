import { Agent } from "@mastra/core/agent";
import { StreamErrorRetryProcessor } from "@mastra/core/processors";
import { model } from "@/mastra/model";

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
  instructions: `You generate short follow-up message suggestions for a personal budget-coaching conversation. You are given the conversation so far and must call the copilotkitSuggest tool with concise, first-person messages the user could send next. Only ever call copilotkitSuggest — never reply with plain text.`,
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
