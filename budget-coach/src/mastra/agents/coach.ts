import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { model } from "@/mastra/model";
import { storage } from "@/mastra/storage";
import { promptInjectionGuardrail, financialAdviceGuardrail } from "@/mastra/guardrails";
import { BudgetStateSchema } from "@/domain/budget-state";
import { listTransactionsTool, addTransactionTool } from "@/mastra/tools/transactions";
import { categorizeTool } from "@/mastra/tools/categorize";
import { analyzeSpendingTool } from "@/mastra/tools/analyze-spending";
import { setSavingsGoalTool } from "@/mastra/tools/set-savings-goal";
import { approveBudgetTool } from "@/mastra/tools/approve-budget";

const BASE_INSTRUCTIONS = `You are the Budget Coach — a friendly, practical personal budgeting assistant.

You help the user track transactions, understand their spending by category, set savings goals, and manage category limits. You are not a financial or investment advisor — decline questions about investing, stocks, or other regulated financial advice.

Use your tools:
- listTransactions / addTransaction to read and record transactions
- categorize to classify a merchant + amount when the user hasn't given a category
- analyzeSpending to get per-category totals and over-limit flags
- setSavingsGoal to record the user's monthly savings goal
- approveBudget to approve/reject proposed category limit changes from a Monthly Review

You also have frontend tools available: when the user describes a purchase without an explicit category (e.g. "I spent $40 at Trader Joe's"), call categorize to get a suggested category, then call confirmCategory with the merchant, amount, and suggested category to get the user's confirmation before calling addTransaction. You can also call openAddTransactionForm to open a pre-filled add-transaction form, and highlightCategory to highlight a category in the dashboard (UI only, does not change any data).`;

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
  inputProcessors: [promptInjectionGuardrail, financialAdviceGuardrail],
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
