import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { RequestContext } from "@mastra/core/request-context";
import { AnalysisResultSchema } from "@/domain/analysis";
import { analystAgent } from "@/mastra/agents/analyst";
import { resolveResourceId } from "@/mastra/get-resource-id";
import { parseWorkingMemory } from "@/mastra/parse-working-memory";

// Agent-as-tool: wraps the Analyst agent. The Analyst has no memory of its
// own, so this tool fetches the Coach's current categoryLimits from working
// memory itself (rather than trusting the model to recall them correctly)
// and passes resourceId via requestContext (not a prompt argument, so it
// can't be spoofed by the model).
export const analyzeSpendingTool = createTool({
  id: "analyze-spending",
  description: "Analyze the current user's spending against their category limits.",
  inputSchema: z.object({}),
  outputSchema: AnalysisResultSchema,
  execute: async (_input, context) => {
    const resourceId = resolveResourceId(context);
    const threadId = context.agent?.threadId;

    let categoryLimits: Record<string, number> = {};
    if (threadId) {
      const coachAgent = context.mastra?.getAgent("coach");
      const memory = await coachAgent?.getMemory();
      const raw = memory ? await memory.getWorkingMemory({ threadId, resourceId }) : null;
      categoryLimits = (parseWorkingMemory(raw).categoryLimits as Record<string, number> | undefined) ?? {};
    }

    const requestContext = new RequestContext();
    requestContext.set("resourceId", resourceId);

    const emptyResult = { categoryTotals: [], trailingSpend: 0 };

    const result = await analystAgent.generate(
      `Category limits (JSON): ${JSON.stringify(categoryLimits)}\n\nCall analyzeTransactions and report the result.`,
      { requestContext }
    );

    // Read the analyzeTransactions tool's own (deterministically-computed)
    // result directly rather than trusting the model's text reply — local
    // models reliably mangle multi-category sums when asked to relay them
    // in prose, even when told not to recompute.
    const toolResult = result.toolResults?.find((r) => r.payload.toolName === "analyzeTransactions");
    return (toolResult?.payload.result as z.infer<typeof AnalysisResultSchema> | undefined) ?? emptyResult;
  },
});
