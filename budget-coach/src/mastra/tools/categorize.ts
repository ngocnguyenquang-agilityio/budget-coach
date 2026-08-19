import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { CategorySchema } from "@/domain/categories";
import { categorizerAgent } from "@/mastra/agents/categorizer";

// Agent-as-tool: wraps the Categorizer agent so the Coach can delegate
// classification while getting a schema-validated category back, rather
// than trusting free-text output.
const CategorizeOutputSchema = z.object({
  type: z.enum(["income", "expense"]),
  category: CategorySchema.optional(),
});

export const categorizeTool = createTool({
  id: "categorize-transaction",
  description: "Classify a merchant + amount as income or expense, and (for expenses) into exactly one budget category.",
  inputSchema: z.object({
    merchant: z.string(),
    amount: z.number(),
  }),
  outputSchema: CategorizeOutputSchema,
  execute: async ({ merchant, amount }) => {
    try {
      const result = await categorizerAgent.generate(`Merchant: ${merchant}\nAmount: ${amount}`, {
        structuredOutput: { schema: CategorizeOutputSchema },
      });

      if (result.object?.type === "income") return { type: "income" as const };
      return { type: "expense" as const, category: result.object?.category ?? "Other" };
    } catch {
      // Same weak-model structured-output failure mode documented in
      // analyze-spending.ts — degrade to "Other" rather than fail the
      // Coach's tool call.
      return { type: "expense" as const, category: "Other" as const };
    }
  },
});
