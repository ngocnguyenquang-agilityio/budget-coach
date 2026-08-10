import { NextResponse } from "next/server";
import { mastra } from "@/mastra";
import { getResourceId } from "@/mastra/get-resource-id";
import { parseWorkingMemory } from "@/mastra/parse-working-memory";

// Called once from the dashboard on mount. Chat-triggered reviews ("run my
// monthly review") go through the Coach's approveBudgetTool instead — this
// route only handles the automatic once-a-month trigger.
export async function POST(req: Request) {
  const resourceId = getResourceId(req);
  // No chat thread exists yet at dashboard-mount time; resource-scoped
  // working memory only keys off resourceId, so any stable threadId works.
  const threadId = resourceId;

  const coachAgent = mastra.getAgent("coach");
  const memory = await coachAgent.getMemory();
  const raw = memory ? await memory.getWorkingMemory({ threadId, resourceId }) : null;
  const lastReviewDate = parseWorkingMemory(raw).lastReviewDate as string | undefined;

  const currentMonth = new Date().toISOString().slice(0, 7);
  if (lastReviewDate?.slice(0, 7) === currentMonth) {
    return NextResponse.json({ started: false, reason: "already reviewed this month" });
  }

  const workflow = mastra.getWorkflow("monthlyReviewWorkflow");
  const run = await workflow.createRun();
  const result = await run.start({ inputData: { resourceId, threadId } });

  return NextResponse.json({ started: true, status: result.status });
}
