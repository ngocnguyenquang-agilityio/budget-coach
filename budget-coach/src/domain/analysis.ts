import { z } from "zod";
import { CategorySchema, type Category } from "./categories";

// Pinned output shape for the Analyst agent — kept stable so the Coach (and
// later the Monthly Review workflow) can rely on its structure.
export const CategoryTotalSchema = z.object({
  category: CategorySchema,
  total: z.number(),
  overLimit: z.boolean(),
});

export const AnalysisResultSchema = z.object({
  categoryTotals: z.array(CategoryTotalSchema),
  trailingSpend: z.number(),
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

const TRAILING_DAYS = 30;

interface AnalyzableTransaction {
  category: Category;
  amount: number;
  date: string;
}

// Deterministic aggregation, deliberately not left to the LLM: local models
// (e.g. llama3.1 via Ollama) reliably mis-add category totals with more than
// a couple of line items. The Analyst calls this via a tool so the numbers
// are always exact regardless of model strength.
export const computeAnalysis = (
  transactions: AnalyzableTransaction[],
  categoryLimits: Partial<Record<Category, number>>
): AnalysisResult => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - TRAILING_DAYS);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const totals = new Map<Category, number>();

  for (const transaction of transactions) {
    if (transaction.category === "Income") continue;
    if (transaction.date < cutoffDate) continue;

    totals.set(transaction.category, (totals.get(transaction.category) ?? 0) + transaction.amount);
  }

  const categoryTotals = [...totals.entries()].map(([category, total]) => {
    const limit = categoryLimits[category];
    return {
      category,
      total,
      overLimit: limit !== undefined && total > limit,
    };
  });

  const trailingSpend = categoryTotals.reduce((sum, entry) => sum + entry.total, 0);

  return { categoryTotals, trailingSpend };
};
