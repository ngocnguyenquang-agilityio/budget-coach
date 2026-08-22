import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { resolveResourceId } from "@/mastra/get-resource-id";
import { parseWorkingMemory } from "@/mastra/parse-working-memory";
import { MonthlyReviewSuspendSchema, MonthlyReviewResumeSchema } from "@/mastra/workflows/monthly-review-workflow";

// The Coach's entry point into monthlyReviewWorkflow. Suspends server-side
// (tool-level suspend, distinct from the workflow's own approvalGate suspend)
// so CopilotKit v2's useInterrupt can render the proposal and relay the
// user's decision back via resumeData.
export const approveBudgetTool = createTool({
  id: "approve-budget",
  description: "Run the Monthly Review and approve or reject the proposed category limit adjustments.",
  inputSchema: z.object({}),
  suspendSchema: MonthlyReviewSuspendSchema,
  resumeSchema: MonthlyReviewResumeSchema,
  outputSchema: z.object({ message: z.string() }),
  execute: async (_input, context) => {
    const resourceId = resolveResourceId(context);
    const threadId = context.agent?.threadId;
    if (!threadId) {
      throw new Error("Missing threadId — approveBudget must be called within an agent thread");
    }

    const { resumeData, suspend } = context.agent ?? {};
    if (!suspend) {
      throw new Error("Missing suspend — approveBudget must be called within an agent thread");
    }

    const workflow = context.mastra?.getWorkflow("monthlyReviewWorkflow");
    if (!workflow) {
      throw new Error("monthlyReviewWorkflow is not registered");
    }

    if (resumeData) {
      const coachAgent = context.mastra?.getAgent("coach");
      const memory = await coachAgent?.getMemory();
      const raw = memory ? await memory.getWorkingMemory({ threadId, resourceId }) : null;
      const pending = parseWorkingMemory(raw).pendingApproval as { runId?: string } | undefined;

      if (!pending?.runId) {
        return { message: "There's no pending Monthly Review to respond to." };
      }

      const run = await workflow.createRun({ runId: pending.runId });
      await run.resume({ resumeData });

      return {
        message:
          resumeData.decision === "approve"
            ? "Approved — your new category limits are saved."
            : "Rejected — your budget is unchanged.",
      };
    }

    const coachAgent = context.mastra?.getAgent("coach");
    const memory = await coachAgent?.getMemory();
    const raw = memory ? await memory.getWorkingMemory({ threadId, resourceId }) : null;
    const current = parseWorkingMemory(raw);

    // At most one Monthly Review may be Pending Approval at a time — a second
    // trigger before the first is decided would overwrite pendingApproval's
    // runId and orphan the first suspended run.
    const pendingApproval = current.pendingApproval as { runId?: string } | undefined;
    if (pendingApproval?.runId) {
      return { message: "You already have a Monthly Review awaiting your decision." };
    }

    const lastReviewPeriod = current.lastReviewPeriod as string | undefined;
    const currentMonth = new Date().toISOString().slice(0, 7);
    if (lastReviewPeriod === currentMonth) {
      return { message: "You've already completed this month's budget review." };
    }

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { resourceId, threadId } });

    if (result.status === "suspended") {
      // result.suspendPayload is keyed by suspended step id, not the flat
      // payload — read the approval-gate step's own suspendPayload instead.
      return suspend(result.steps["approval-gate"].suspendPayload);
    }

    return { message: "No budget changes were needed this month." };
  },
});
