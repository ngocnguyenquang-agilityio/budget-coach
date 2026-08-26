import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { resolveResourceId } from "@/mastra/get-resource-id";
import { parseWorkingMemory } from "@/mastra/parse-working-memory";
import { addTransaction, deleteTransactionsByMerchantForMonth } from "@/db/transactions";
import { DECLARED_INCOME_MERCHANT } from "@/constants/declared-income";

// Writes directly to the Coach's resource-scoped working memory rather than
// relying on the model to phrase an update through the auto-injected
// updateWorkingMemory tool — read-merge-write so we never clobber the rest
// of BudgetState (savingsGoal, categoryLimits, lastReviewPeriod, pendingApproval).
export const setDeclaredIncomeTool = createTool({
  id: "set-declared-income",
  description: "Set the user's declared income for a Monthly Review or when they report a change.",
  inputSchema: z.object({ declaredIncome: z.number().positive() }),
  outputSchema: z.object({ declaredIncome: z.number() }),
  execute: async ({ declaredIncome }, context) => {
    const resourceId = resolveResourceId(context);
    const threadId = context.agent?.threadId;

    if (!threadId) {
      throw new Error("Missing threadId — set-declared-income must be called within an agent thread");
    }

    const coachAgent = context.mastra?.getAgent("coach");
    const memory = await coachAgent?.getMemory();

    if (!memory) {
      throw new Error("Coach memory is not configured");
    }

    const raw = await memory.getWorkingMemory({ threadId, resourceId });
    const current = parseWorkingMemory(raw);
    const next = { ...current, declaredIncome };

    await memory.updateWorkingMemory({ threadId, resourceId, workingMemory: JSON.stringify(next) });

    // Mirror the declared figure into this month's Income so the dashboard's
    // "Income this month" reflects it. Upsert-by-month (delete-then-insert the
    // marker merchant) keeps re-declaring in the same Period from stacking
    // duplicate income rows.
    const date = new Date().toISOString().slice(0, 10);
    const period = date.slice(0, 7);
    await deleteTransactionsByMerchantForMonth(resourceId, DECLARED_INCOME_MERCHANT, period);
    await addTransaction({
      resourceId,
      merchant: DECLARED_INCOME_MERCHANT,
      amount: declaredIncome,
      type: "income",
      category: null,
      date,
      seedCategory: null,
    });

    return { declaredIncome };
  },
});
