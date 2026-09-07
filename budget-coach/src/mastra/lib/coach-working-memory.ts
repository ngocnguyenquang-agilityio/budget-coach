import { resolveResourceId } from "@/mastra/lib/get-resource-id";
import { parseWorkingMemory } from "@/mastra/lib/parse-working-memory";
import { ToolPreconditionError } from "@/mastra/tools/with-tool-error-handling";

// Read-merge-write access to the Coach's resource-scoped working memory,
// shared by the Savings Pot tools. Mirrors the inline pattern in
// set-savings-goal.ts / set-declared-income.ts (read current, merge, write the
// whole object back) so a pot write never clobbers the rest of BudgetState.
// `save` persists a full replacement object — callers spread `current` into it.
export const openBudgetState = async (context: {
  agent?: { resourceId?: string; threadId?: string };
  requestContext?: { get(key: string): unknown };
  mastra?: {
    getAgent(id: string):
      | {
          getMemory(): Promise<
            | {
                getWorkingMemory(args: { threadId: string; resourceId: string }): Promise<string | null>;
                updateWorkingMemory(args: {
                  threadId: string;
                  resourceId: string;
                  workingMemory: string;
                }): Promise<unknown>;
              }
            | undefined
            | null
          >;
        }
      | undefined;
  };
}) => {
  const resourceId = resolveResourceId(context);
  const threadId = context.agent?.threadId;
  if (!threadId) {
    throw new ToolPreconditionError(
      "Missing threadId — savings-pot tools must be called within an agent thread",
    );
  }

  const coachAgent = context.mastra?.getAgent("coach");
  const memory = coachAgent ? await coachAgent.getMemory() : null;
  if (!memory) {
    throw new ToolPreconditionError("Coach memory is not configured");
  }

  const raw = await memory.getWorkingMemory({ threadId, resourceId });
  const current = parseWorkingMemory(raw);
  const save = (next: Record<string, unknown>) =>
    memory.updateWorkingMemory({ threadId, resourceId, workingMemory: JSON.stringify(next) });

  return { current, save };
};
