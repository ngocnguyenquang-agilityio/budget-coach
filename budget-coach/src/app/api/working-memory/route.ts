import { NextResponse } from "next/server";
import { getResourceId } from "@/mastra/get-resource-id";
import { storage } from "@/mastra/storage";
import { BudgetStateSchema, type BudgetState } from "@/domain/budget-state";

// Plain (non-agent) route the dashboard reads on mount to hydrate the
// Coach's resource-scoped working memory. Nothing in the CopilotKit v2
// frontend re-fetches agent.state on page load (it only reflects live
// stream updates from the current session), so without this the dashboard
// shows "no limit set" after every reload until the next chat turn.
export const GET = async (req: Request) => {
  const resourceId = getResourceId(req);

  const memoryStore = await storage.getStore("memory");
  const resource = await memoryStore?.getResourceById({ resourceId });
  if (!resource?.workingMemory) {
    return NextResponse.json({ state: {} satisfies BudgetState });
  }

  const parsed = BudgetStateSchema.safeParse(JSON.parse(resource.workingMemory));
  return NextResponse.json({ state: parsed.success ? parsed.data : {} });
};
