import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { CategorySchema } from "@/domain/categories";
import { AnalysisResultSchema, computeAnalysis } from "@/domain/analysis";
import { listTransactions, seedIfEmpty } from "@/db/transactions";
import { resolveResourceId } from "@/mastra/get-resource-id";

// partialRecord, not record — Zod v4's z.record with an enum key schema
// requires every enum key present, which rejects the common case of only a
// few categories having limits set (including {}).
const CategoryLimitsSchema = z.partialRecord(CategorySchema, z.number());

// Open-weight models (e.g. this app's gpt-oss-120b via Cerebras) sometimes pass this as a JSON
// string instead of an object, despite the schema — parse defensively,
// mirroring how tool *outputs* are already parsed defensively elsewhere
// (src/mastra/parse-working-memory.ts).
const CategoryLimitsInputSchema = z
  .union([CategoryLimitsSchema, z.string()])
  .optional()
  .transform((value) => {
    if (typeof value !== "string") return value ?? {};
    try {
      const parsed: unknown = JSON.parse(value);
      return CategoryLimitsSchema.safeParse(parsed).data ?? {};
    } catch {
      return {};
    }
  });

export const analyzeTransactionsTool = createTool({
  id: "analyze-transactions",
  description: "Fetch transactions and compute per-category totals, over-limit flags, and trailing spend.",
  inputSchema: z.object({
    categoryLimits: CategoryLimitsInputSchema,
  }),
  outputSchema: AnalysisResultSchema,
  execute: async ({ categoryLimits }, context) => {
    const resourceId = resolveResourceId(context);
    await seedIfEmpty(resourceId);
    const transactions = await listTransactions(resourceId);
    return computeAnalysis(transactions, categoryLimits ?? {});
  },
});
