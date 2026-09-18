import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { CategorySchema } from "@/domain/categories";
import { categorizerAgent } from "@/mastra/agents/categorizer";
import { withToolErrorHandling } from "@/mastra/tools/with-tool-error-handling";

// Agent-as-tool: wraps the Categorizer agent so the Coach can delegate
// classification while getting a schema-validated category back, rather
// than trusting free-text output.
const CategorizeOutputSchema = z.object({
  type: z.enum(["income", "expense"]),
  category: CategorySchema.optional(),
});

type CategorizeResult = z.infer<typeof CategorizeOutputSchema>;

const CategorizeBatchOutputSchema = z.object({
  results: z.array(CategorizeOutputSchema),
});

// The deterministic seam between the (unreliable, weak-model) categorizer
// output and the batch tool's contract: exactly one entry per input item, in
// order. Anything missing or malformed — a short array, a dropped `type`, an
// expense with no category — degrades to expense/"Other" for that index
// rather than failing the batch or misaligning the rest (same degrade-to-
// "Other" posture as the single-item path and analyze-spending.ts).
export const reconcileBatchCategories = (
  items: Array<{ merchant: string; amount: number }>,
  raw: Array<Partial<CategorizeResult>> | undefined
): CategorizeResult[] =>
  items.map((_item, index) => {
    const entry = raw?.[index];
    if (entry?.type === "income") return { type: "income" as const };
    if (entry?.type === "expense") return { type: "expense" as const, category: entry.category ?? "Other" };
    return { type: "expense" as const, category: "Other" as const };
  });

export const categorizeBatchTool = createTool({
  id: "categorize-batch",
  description:
    "Classify one or more transactions in a single pass. Each item is a merchant + amount; each result is income or expense, and (for expenses) exactly one budget category. Results are returned in the same order as the input.",
  inputSchema: z.object({
    items: z.array(z.object({ merchant: z.string(), amount: z.number() })),
  }),
  outputSchema: CategorizeBatchOutputSchema,
  execute: withToolErrorHandling(async ({ items }) => {
    // One agent call for the whole batch — keeps Cerebras request count flat
    // regardless of N (the free tier caps at 5 req/min).
    const prompt = `Classify each of these transactions:\n${items
      .map((item, index) => `${index + 1}. Merchant: ${item.merchant}, Amount: ${item.amount}`)
      .join("\n")}`;
    const result = await categorizerAgent.generate(prompt, {
      structuredOutput: { schema: CategorizeBatchOutputSchema },
    });
    // Two distinct failure modes, deliberately handled differently:
    //   - The weak model returned but produced no valid structured object
    //     (result.object undefined) — the expected benign case;
    //     reconcileBatchCategories degrades it to expense/"Other".
    //   - A genuine API/network/rate-limit failure throws (after
    //     StreamErrorRetryProcessor exhausts its retries) — withToolErrorHandling
    //     turns that into { success: false, code: "TOOL_ERROR" } so the Coach
    //     surfaces the failure, rather than silently mis-categorizing every
    //     item as "Other" and pretending it worked.
    return { results: reconcileBatchCategories(items, result.object?.results) };
  }),
});
