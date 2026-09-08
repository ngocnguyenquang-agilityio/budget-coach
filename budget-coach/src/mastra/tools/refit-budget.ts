import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { resolveResourceId } from "@/mastra/lib/get-resource-id";
import { parseWorkingMemory } from "@/mastra/lib/parse-working-memory";
import { RefitSuspendSchema, RefitResumeSchema } from "@/mastra/workflows/refit-workflow";
import { withToolErrorHandling, ToolPreconditionError } from "@/mastra/tools/with-tool-error-handling";

// The Coach's entry point into refitWorkflow — the forward-looking counterpart
// to approveBudgetTool. Called when a Commitment-ledger change reports
// `refitNeeded` (ADR-0014), not when the user asks for a re-fit: with no
// ledger change and no new spend data there is nothing new to compute.
//
// Suspends server-side (tool-level suspend) so CopilotKit v2's useInterrupt
// can render the RefitCard and relay the decision back via resumeData.
export const refitBudgetTool = createTool({
  id: "refit-budget",
  description:
    "Re-fit the user's category limits after something changed what they've committed to saving — a new or edited savings pot, or a change to their recurring income. Call this when a pot or income tool reports refitNeeded. Do not call it speculatively: with nothing changed it proposes nothing.",
  inputSchema: z.object({}),
  suspendSchema: RefitSuspendSchema,
  resumeSchema: RefitResumeSchema,
  outputSchema: z.object({ message: z.string() }),
  execute: withToolErrorHandling(async (_input, context) => {
    const resourceId = resolveResourceId(context);
    const threadId = context.agent?.threadId;
    if (!threadId) {
      throw new ToolPreconditionError("Missing threadId — refitBudget must be called within an agent thread");
    }

    const { resumeData, suspend } = context.agent ?? {};
    if (!suspend) {
      throw new ToolPreconditionError("Missing suspend — refitBudget must be called within an agent thread");
    }

    const workflow = context.mastra?.getWorkflow("refitWorkflow");
    if (!workflow) {
      throw new ToolPreconditionError("refitWorkflow is not registered");
    }

    const coachAgent = context.mastra?.getAgent("coach");
    const memory = await coachAgent?.getMemory();

    if (resumeData) {
      const raw = memory ? await memory.getWorkingMemory({ threadId, resourceId }) : null;
      const pending = parseWorkingMemory(raw).pendingApproval as
        | { runId?: string; workflow?: string }
        | undefined;

      if (!pending?.runId || pending.workflow !== "refit") {
        return { message: "There's no pending budget re-fit to respond to." };
      }

      const run = await workflow.createRun({ runId: pending.runId });
      await run.resume({ resumeData });

      return {
        message:
          resumeData.decision === "approve"
            ? "Approved — your new category limits are saved."
            : "Rejected — your limits are unchanged, but your savings pots still claim that money.",
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

    const run = await workflow.createRun();
    const result = await run.start({ inputData: { resourceId, threadId } });

    if (result.status === "suspended") {
      // suspendPayload is keyed by suspended step id, not the flat payload.
      return suspend(result.steps["approval-gate"].suspendPayload);
    }

    if (result.status === "success") {
      const output = result.result;
      if (output.status === "impossible") {
        return {
          message:
            "Your savings pots now claim everything you earn, so there's nothing left for category limits. Push a deadline out or lower a target.",
        };
      }
      if (output.status === "fits") {
        return { message: "Your current limits still fit — no changes needed." };
      }
    }

    return { message: "No budget changes were needed." };
  }),
});
