import { Agent } from "@mastra/core/agent";
import { StreamErrorRetryProcessor } from "@mastra/core/processors";
import { Memory } from "@mastra/memory";
import { model } from "@/mastra/model";
import { storage } from "@/mastra/storage";
import { promptInjectionGuardrail, financialAdviceGuardrail } from "@/mastra/guardrails";
import { DedupeToolCallsProcessor } from "@/mastra/processors/dedupe-tool-calls";
import { BudgetStateSchema } from "@/domain/budget-state";
import { listTransactionsTool, addTransactionTool } from "@/mastra/tools/transactions";
import { categorizeTool } from "@/mastra/tools/categorize";
import { analyzeSpendingTool } from "@/mastra/tools/analyze-spending";
import { setSavingsGoalTool } from "@/mastra/tools/set-savings-goal";
import { approveBudgetTool } from "@/mastra/tools/approve-budget";
import { coachScopeScorer } from "@/mastra/scorers/coach-scope";

const BASE_INSTRUCTIONS = `You are the Budget Coach — a friendly, practical personal budgeting assistant.

You help the user track transactions, understand their spending by category, set savings goals, and manage category limits. You are not a financial or investment advisor — decline questions about investing, stocks, or other regulated financial advice.

Use your tools:
- listTransactions / addTransaction to read and record transactions
- categorize to classify a merchant + amount when the user hasn't given a category
- analyzeSpending to get per-category totals and over-limit flags
- setSavingsGoal to record the user's monthly savings goal
- approveBudget to approve/reject proposed category limit changes from a Monthly Review

You also have frontend tools available: when the user describes a purchase without an explicit category (e.g. "I spent $40 at Trader Joe's"), call categorize to get a suggested category, then call confirmCategory with the merchant, amount, and suggested category to get the user's confirmation before calling addTransaction. You can also call openAddTransactionForm to open a pre-filled add-transaction form, and highlightCategory to highlight a category in the dashboard (UI only, does not change any data).

IMPORTANT — highlightCategory supports exactly one category, never more. If the user names two or more categories to highlight in the same request (e.g. "highlight Dining and Health"), you MUST NOT call highlightCategory and MUST NOT pick one yourself. Instead, reply telling them only one category can be highlighted at a time and ask them to choose which single one they want. Only call highlightCategory after the user's reply names exactly one category.`;

// Coach's instructions read frontend context that @ag-ui/mastra parks under
// the "ag-ui" requestContext key — it is not injected into the prompt
// automatically, so this has to happen explicitly.
export const coachAgent = new Agent({
  id: "coach",
  name: "Coach",
  model,
  instructions: async ({ requestContext }) => {
    const frontendContext = requestContext?.get("ag-ui");
    if (!frontendContext) return BASE_INSTRUCTIONS;
    return `${BASE_INSTRUCTIONS}\n\nFrontend context:\n${JSON.stringify(frontendContext)}`;
  },
  inputProcessors: [new DedupeToolCallsProcessor(), promptInjectionGuardrail, financialAdviceGuardrail],
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
    coachScope: {
      scorer: coachScopeScorer,
      sampling: { type: "ratio", rate: 1 },
    },
  },
  tools: {
    listTransactions: listTransactionsTool,
    addTransaction: addTransactionTool,
    categorize: categorizeTool,
    analyzeSpending: analyzeSpendingTool,
    setSavingsGoal: setSavingsGoalTool,
    approveBudget: approveBudgetTool,
  },
  memory: new Memory({
    storage,
    options: {
      lastMessages: 10,
      workingMemory: {
        enabled: true,
        scope: "resource",
        schema: BudgetStateSchema,
      },
    },
  }),
});
