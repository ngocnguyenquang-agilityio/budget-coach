import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { resolveResourceId } from "@/mastra/get-resource-id";
import { parseWorkingMemory } from "@/mastra/parse-working-memory";
import { CategorySchema } from "@/domain/categories";
import { CoachPreferencesSchema } from "@/domain/budget-state";

const sanitizeNickname = (nickname: string): string =>
  nickname
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim()
    .slice(0, 50);

// Writes directly to the Coach's resource-scoped working memory rather than
// relying on the model to phrase an update through the auto-injected
// updateWorkingMemory tool — read-merge-write so we never clobber the rest
// of BudgetState (savingsGoal, categoryLimits, lastReviewPeriod, pendingApproval),
// mirroring setSavingsGoalTool.
export const setCoachPreferenceTool = createTool({
  id: "set-coach-preference",
  description:
    "Update the user's stored preferences for how the Coach communicates — verbosity, preferred form of address, and which categories to emphasize. Only call this when the user explicitly states a preference.",
  inputSchema: z.object({
    verbosity: z.enum(["concise", "detailed"]).optional(),
    nickname: z.string().max(50).optional(),
    emphasizedCategories: z.array(CategorySchema).optional(),
  }),
  outputSchema: CoachPreferencesSchema,
  execute: async ({ verbosity, nickname, emphasizedCategories }, context) => {
    const resourceId = resolveResourceId(context);
    const threadId = context.agent?.threadId;

    if (!threadId) {
      throw new Error(
        "Missing threadId — set-coach-preference must be called within an agent thread",
      );
    }

    const coachAgent = context.mastra?.getAgent("coach");
    const memory = await coachAgent?.getMemory();

    if (!memory) {
      throw new Error("Coach memory is not configured");
    }

    const raw = await memory.getWorkingMemory({ threadId, resourceId });
    const current = parseWorkingMemory(raw);
    const currentPreferences =
      (current.coachPreferences as Record<string, unknown> | undefined) ?? {};
    const sanitizedNickname =
      nickname !== undefined ? sanitizeNickname(nickname) : undefined;

    const nextPreferences = {
      ...currentPreferences,
      ...(verbosity !== undefined ? { verbosity } : {}),
      ...(sanitizedNickname ? { nickname: sanitizedNickname } : {}),
      ...(emphasizedCategories !== undefined ? { emphasizedCategories } : {}),
    };

    const next = { ...current, coachPreferences: nextPreferences };
    await memory.updateWorkingMemory({
      threadId,
      resourceId,
      workingMemory: JSON.stringify(next),
    });

    return nextPreferences;
  },
});
