import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { currentPeriod } from "@/domain/period";
import { resolveResourceId } from "@/mastra/lib/get-resource-id";
import { parseWorkingMemory } from "@/mastra/lib/parse-working-memory";
import { loadBudgetContext } from "@/mastra/lib/budget-context";
import { isPendingApprovalStale, type PendingApproval } from "@/mastra/lib/pending-approval";
import { MonthlyReviewSuspendSchema, MonthlyReviewResumeSchema } from "@/mastra/workflows/monthly-review-workflow";
import { withToolErrorHandling, ToolPreconditionError } from "@/mastra/tools/with-tool-error-handling";

// The Coach's entry point into monthlyReviewWorkflow. Suspends server-side
// (tool-level suspend, distinct from the workflow's own approvalGate suspend)
// so CopilotKit v2's useInterrupt can render the proposal and relay the
// user's decision back via resumeData.
export const approveBudgetTool = createTool({
  id: "approve-budget",
  description:
    "Run the Monthly Review: close out any finished months (rolling their net savings into the user's savings), then approve or reject proposed category limit adjustments.",
  inputSchema: z.object({}),
  suspendSchema: MonthlyReviewSuspendSchema,
  resumeSchema: MonthlyReviewResumeSchema,
  outputSchema: z.object({ message: z.string() }),
  execute: withToolErrorHandling(async (_input, context) => {
    const resourceId = resolveResourceId(context);
    const threadId = context.agent?.threadId;
    if (!threadId) {
      throw new ToolPreconditionError("Missing threadId — approveBudget must be called within an agent thread");
    }

    const { resumeData, suspend } = context.agent ?? {};
    if (!suspend) {
      throw new ToolPreconditionError("Missing suspend — approveBudget must be called within an agent thread");
    }

    const workflow = context.mastra?.getWorkflow("monthlyReviewWorkflow");
    if (!workflow) {
      throw new ToolPreconditionError("monthlyReviewWorkflow is not registered");
    }

    if (resumeData) {
      const coachAgent = context.mastra?.getAgent("coach");
      const memory = await coachAgent?.getMemory();
      const raw = memory ? await memory.getWorkingMemory({ threadId, resourceId }) : null;
      const pending = parseWorkingMemory(raw).pendingApproval as
        | { runId?: string; workflow?: string }
        | undefined;

      // Positive check, not a denylist: anything that isn't ours is rejected,
      // including the retired "funding-plan" value still sitting in working
      // memory for users who had one pending when it was renamed. `workflow`
      // may be absent on runs suspended before the discriminator existed —
      // treat absent as "monthly-review" (its original owner).
      if (!pending?.runId || (pending.workflow && pending.workflow !== "monthly-review")) {
        return { message: "There's no pending Monthly Review to respond to." };
      }

      const run = await workflow.createRun({ runId: pending.runId });
      await run.resume({ resumeData });

      return {
        message:
          resumeData.decision === "approve"
            ? "Approved — your new category limits are saved and your savings are up to date."
            : "Rejected — your budget is unchanged.",
      };
    }

    const { current, save, cap, forecastIncome, commitments } = await loadBudgetContext(context);

    // At most one Monthly Review may be Pending Approval at a time — a second
    // trigger before the first is decided would overwrite pendingApproval's
    // runId and orphan the first suspended run.
    const pendingApproval = current.pendingApproval as PendingApproval | undefined;
    if (pendingApproval?.runId) {
      if (!isPendingApprovalStale(pendingApproval)) {
        return { message: "You already have an approval awaiting your decision." };
      }
      // Abandoned: its suspend interrupt was never resumed, so applyOrDiscard
      // never ran to clear it. Clear it here instead of blocking forever.
      await save({ ...current, pendingApproval: null });
    }

    const lastReviewPeriod = current.lastReviewPeriod as string | undefined;
    if (lastReviewPeriod === currentPeriod()) {
      return { message: "You've already completed this month's budget review." };
    }

    // Category Limits are capped at Forecast Income − Commitments (ADR-0014).
    // Income now comes from the Transaction ledger rather than a declared
    // figure, so "no income yet" is the thing to ask about — there's nothing
    // to budget against until something is recorded.
    if (forecastIncome <= 0) {
      return {
        message:
          "I don't have any income recorded for this month yet, so there's nothing to budget against. Tell me what you've been paid, or set up your salary as a recurring payment.",
      };
    }

    // Refuse before the workflow's proposeAdjustments step (which throws on a
    // non-positive cap) is ever reached.
    if (cap <= 0) {
      return {
        message: `Your savings pots claim $${commitments.toFixed(2)}/mo out of $${forecastIncome.toFixed(2)} income, which leaves nothing for category limits. Lower a target or push a deadline out, then run the review again.`,
      };
    }

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { resourceId, threadId } });

    if (result.status === "suspended") {
      // result.suspendPayload is keyed by suspended step id, not the flat
      // payload — read the approval-gate step's own suspendPayload instead.
      return suspend(result.steps["approval-gate"].suspendPayload);
    }

    return { message: "No budget changes were needed this month." };
  }),
});
