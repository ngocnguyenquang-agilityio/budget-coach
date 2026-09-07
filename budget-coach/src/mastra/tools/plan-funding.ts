import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { resolveResourceId } from "@/mastra/lib/get-resource-id";
import { parseWorkingMemory } from "@/mastra/lib/parse-working-memory";
import { TargetSchema } from "@/domain/funding-plan";
import {
  FundingPlanSuspendSchema,
  FundingPlanResumeSchema,
} from "@/mastra/workflows/goal-funding-workflow";
import { withToolErrorHandling, ToolPreconditionError } from "@/mastra/tools/with-tool-error-handling";

// The Coach's entry point into goalFundingWorkflow — the forward-looking
// counterpart to approveBudgetTool. Suspends server-side (tool-level suspend)
// so CopilotKit v2's useInterrupt can render the FundingPlanCard and relay the
// user's decision back via resumeData. Unlike a Monthly Review it needs only
// Declared Income (not a pre-set Savings Goal) — Capacity is Declared Income
// minus committed Category Limits (ADR-0008).
export const planFundingTool = createTool({
  id: "plan-funding",
  description:
    "Plan how to reach a savings goal or afford a purchase by proposing category-limit cuts. Use for a forward-looking target (\"save $2,000 by December\", \"can I afford a $1,200 laptop\"), not to review past spending.",
  inputSchema: TargetSchema,
  suspendSchema: FundingPlanSuspendSchema,
  resumeSchema: FundingPlanResumeSchema,
  outputSchema: z.object({ message: z.string() }),
  execute: withToolErrorHandling(async (target, context) => {
    const resourceId = resolveResourceId(context);
    const threadId = context.agent?.threadId;
    if (!threadId) {
      throw new ToolPreconditionError("Missing threadId — planFunding must be called within an agent thread");
    }

    const { resumeData, suspend } = context.agent ?? {};
    if (!suspend) {
      throw new ToolPreconditionError("Missing suspend — planFunding must be called within an agent thread");
    }

    const workflow = context.mastra?.getWorkflow("goalFundingWorkflow");
    if (!workflow) {
      throw new ToolPreconditionError("goalFundingWorkflow is not registered");
    }

    const coachAgent = context.mastra?.getAgent("coach");
    const memory = await coachAgent?.getMemory();

    if (resumeData) {
      const raw = memory ? await memory.getWorkingMemory({ threadId, resourceId }) : null;
      const pending = parseWorkingMemory(raw).pendingApproval as
        | { runId?: string; workflow?: string }
        | undefined;

      if (!pending?.runId || pending.workflow !== "funding-plan") {
        return { message: "There's no pending funding plan to respond to." };
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

    const raw = memory ? await memory.getWorkingMemory({ threadId, resourceId }) : null;
    const current = parseWorkingMemory(raw);

    // At most one approval may be Pending Approval across both workflows at a
    // time — a second trigger would overwrite pendingApproval's runId and
    // orphan the first suspended run.
    const pendingApproval = current.pendingApproval as { runId?: string } | undefined;
    if (pendingApproval?.runId) {
      return { message: "You already have an approval awaiting your decision." };
    }

    // Capacity needs Declared Income. Unlike a Monthly Review, no Savings Goal
    // is required — a savings target sets it as an outcome.
    const declaredIncome = current.declaredIncome as number | undefined;
    if (declaredIncome === undefined) {
      return { message: "I need your income before I can plan this — what's your income this month?" };
    }

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { resourceId, threadId, target } });

    if (result.status === "suspended") {
      // suspendPayload is keyed by suspended step id, not the flat payload.
      return suspend(result.steps["approval-gate"].suspendPayload);
    }

    if (result.status === "success") {
      const output = result.result;
      if (output.status === "infeasible") {
        return {
          message: `You'd need to set aside $${output.requiredPerMonth}/mo, which is more than your declared income of $${output.declaredIncome} — extend the deadline or lower the target.`,
        };
      }
      if (output.status === "on-track") {
        return {
          message: `You're already on track — no cuts needed. I've set your monthly savings goal to $${output.requiredPerMonth}.`,
        };
      }
      if (output.status === "fits-purchase") {
        return { message: "You can afford that now without cutting anything." };
      }
    }

    return { message: "No budget changes were needed." };
  }),
});
