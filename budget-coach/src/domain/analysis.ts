import { z } from "zod";
import { CategorySchema, type Category } from "./categories";

// Pinned output shape shared by the Analyst agent and the Coach.
export const CategoryTotalSchema = z.object({
  category: CategorySchema,
  total: z.number(),
  overLimit: z.boolean(),
});

export const AnalysisResultSchema = z.object({
  categoryTotals: z.array(CategoryTotalSchema),
  expenseTotal: z.number(),
  incomeTotal: z.number(),
  netSavings: z.number(),
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

interface AnalyzableTransaction {
  type: "income" | "expense";
  category?: Category | null;
  amount: number;
  date: string;
}

// Deterministic aggregation, deliberately not left to the LLM. `period` is
// the calendar month (YYYY-MM) to scope the analysis to — passed in rather
// than read from `new Date()` here so callers (and tests) control it.
export const computeAnalysis = (
  transactions: AnalyzableTransaction[],
  categoryLimits: Partial<Record<Category, number>>,
  period: string
): AnalysisResult => {
  const totals = new Map<Category, number>();
  let incomeTotal = 0;

  for (const transaction of transactions) {
    if (transaction.date.slice(0, 7) !== period) continue;

    if (transaction.type === "income") {
      incomeTotal += transaction.amount;
      continue;
    }

    const category = transaction.category ?? "Other";
    totals.set(category, (totals.get(category) ?? 0) + transaction.amount);
  }

  const categoryTotals = [...totals.entries()].map(([category, total]) => {
    const limit = categoryLimits[category];
    return {
      category,
      total,
      overLimit: limit !== undefined && total > limit,
    };
  });

  const expenseTotal = categoryTotals.reduce((sum, entry) => sum + entry.total, 0);

  return { categoryTotals, expenseTotal, incomeTotal, netSavings: incomeTotal - expenseTotal };
};
