import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { resolveResourceId } from "@/mastra/lib/get-resource-id";
import { parseWorkingMemory } from "@/mastra/lib/parse-working-memory";
import { withToolErrorHandling, ToolPreconditionError } from "@/mastra/tools/with-tool-error-handling";

// Writes directly to the Coach's resource-scoped working memory rather than
// relying on the model to phrase an update through the auto-injected
// updateWorkingMemory tool — read-merge-write so we never clobber the rest
// of BudgetState (categoryLimits, lastReviewPeriod, pendingApproval).
export const setSavingsGoalTool = createTool({
  id: "set-savings-goal",
  description: "Set the user's monthly savings goal.",
  inputSchema: z.object({ savingsGoal: z.number().positive() }),
  outputSchema: z.object({ savingsGoal: z.number() }),
  execute: withToolErrorHandling(async ({ savingsGoal }, context) => {
    const resourceId = resolveResourceId(context);
    const threadId = context.agent?.threadId;

    if (!threadId) {
      throw new ToolPreconditionError("Missing threadId — set-savings-goal must be called within an agent thread");
    }

    const coachAgent = context.mastra?.getAgent("coach");
    const memory = await coachAgent?.getMemory();

    if (!memory) {
      throw new ToolPreconditionError("Coach memory is not configured");
    }

    const raw = await memory.getWorkingMemory({ threadId, resourceId });
    const current = parseWorkingMemory(raw);
    const next = { ...current, savingsGoal };

    await memory.updateWorkingMemory({ threadId, resourceId, workingMemory: JSON.stringify(next) });

    return { savingsGoal };
  }),
});
