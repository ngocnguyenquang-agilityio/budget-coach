import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { CategorySchema } from "@/domain/categories";
import { categorizerAgent } from "@/mastra/agents/categorizer";

// Agent-as-tool: wraps the Categorizer agent so the Coach can delegate
// classification while getting a schema-validated category back, rather
// than trusting free-text output.
export const categorizeTool = createTool({
  id: "categorize-transaction",
  description: "Classify a merchant + amount into exactly one budget category.",
  inputSchema: z.object({
    merchant: z.string(),
    amount: z.number(),
  }),
  outputSchema: z.object({ category: CategorySchema }),
  execute: async ({ merchant, amount }) => {
    try {
      const result = await categorizerAgent.generate(`Merchant: ${merchant}\nAmount: ${amount}`, {
        structuredOutput: { schema: z.object({ category: CategorySchema }) },
      });

      return { category: result.object?.category ?? "Other" };
    } catch {
      // Same weak-model structured-output failure mode documented in
      // analyze-spending.ts — degrade to "Other" rather than fail the
      // Coach's tool call.
      return { category: "Other" as const };
    }
  },
});
