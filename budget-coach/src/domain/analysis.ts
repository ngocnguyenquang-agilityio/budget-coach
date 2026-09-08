import { z } from "zod";
import { CategorySchema, type Category } from "./categories";
import type { TransactionStatus } from "./transaction";

// Pinned output shape shared by the Analyst agent and the Coach.
export const CategoryTotalSchema = z.object({
  category: CategorySchema,
  // Received spending only — money that actually left. Drives `overLimit`.
  spent: z.number(),
  // Received plus still-expected — what this Category is on course to spend.
  // Drives `onTrackToExceed`. Overspending and being about to overspend are
  // different messages and deliberately carry different flags (ADR-0011).
  committed: z.number(),
  overLimit: z.boolean(),
  onTrackToExceed: z.boolean(),
});

export const AnalysisResultSchema = z.object({
  categoryTotals: z.array(CategoryTotalSchema),
  // Received expenses, pot-funded ones included.
  expenseTotal: z.number(),
  // Received + expected expenses.
  committedExpenseTotal: z.number(),
  // Received Income — what has actually arrived.
  receivedIncome: z.number(),
  // Received + expected Income — the basis for the Cap.
  forecastIncome: z.number(),
  // Received Income − received Expenses NOT funded by a Savings Pot. A
  // pot-funded expense spends money saved in an earlier Period that already
  // sits in the Savings Balance, so counting it here would debit the Balance
  // twice — once via the pot, once via the roll-up (ADR-0012).
  netSavings: z.number(),
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export interface AnalyzableTransaction {
  type: "income" | "expense";
  status: TransactionStatus;
  category?: Category | null;
  amount: number;
  date: string;
  fundedByPotId?: string | null;
}

// Deterministic aggregation, deliberately not left to the LLM. `period` is
// the calendar month (YYYY-MM) to scope the analysis to — passed in rather
// than read from `new Date()` here so callers (and tests) control it.
//
// This is the single place Transaction status is interpreted. Callers get
// pre-split figures rather than filtering themselves, because a missed status
// filter produces wrong numbers silently instead of throwing (ADR-0011).
export const computeAnalysis = (
  transactions: AnalyzableTransaction[],
  categoryLimits: Partial<Record<Category, number>>,
  period: string
): AnalysisResult => {
  const spentByCategory = new Map<Category, number>();
  const committedByCategory = new Map<Category, number>();
  let receivedIncome = 0;
  let forecastIncome = 0;
  let potFundedExpense = 0;

  for (const transaction of transactions) {
    if (transaction.date.slice(0, 7) !== period) continue;
    const received = transaction.status === "received";

    if (transaction.type === "income") {
      forecastIncome += transaction.amount;
      if (received) receivedIncome += transaction.amount;
      continue;
    }

    const category = transaction.category ?? "Other";
    committedByCategory.set(category, (committedByCategory.get(category) ?? 0) + transaction.amount);

    if (received) {
      spentByCategory.set(category, (spentByCategory.get(category) ?? 0) + transaction.amount);
      if (transaction.fundedByPotId) potFundedExpense += transaction.amount;
    }
  }

  const categories = new Set([...spentByCategory.keys(), ...committedByCategory.keys()]);
  const categoryTotals = [...categories].map((category) => {
    const spent = spentByCategory.get(category) ?? 0;
    const committed = committedByCategory.get(category) ?? 0;
    const limit = categoryLimits[category];
    return {
      category,
      spent,
      committed,
      overLimit: limit !== undefined && spent > limit,
      // Only a warning: not yet over, but on course to be.
      onTrackToExceed: limit !== undefined && spent <= limit && committed > limit,
    };
  });

  const expenseTotal = categoryTotals.reduce((sum, entry) => sum + entry.spent, 0);
  const committedExpenseTotal = categoryTotals.reduce((sum, entry) => sum + entry.committed, 0);

  return {
    categoryTotals,
    expenseTotal,
    committedExpenseTotal,
    receivedIncome,
    forecastIncome,
    netSavings: round(receivedIncome - (expenseTotal - potFundedExpense)),
  };
};

const round = (value: number): number => Math.round(value * 100) / 100;
