import type { Category } from "@/domain/categories";
import { computeAnalysis, type AnalysisResult } from "@/domain/analysis";
import { computeCap, sumCommitments } from "@/domain/commitment";
import { currentPeriod } from "@/domain/period";
import { parsePots, type SavingsPot } from "@/domain/savings-pot";

// Re-exported: the workflows and tools import it from here alongside
// loadBudgetContext.
export { parsePots };
import { listTransactions } from "@/db/transactions";
import { openBudgetState } from "@/mastra/lib/coach-working-memory";
import { resolveResourceId } from "@/mastra/lib/get-resource-id";

type CategoryLimits = Partial<Record<Category, number>>;

export interface BudgetContext {
  current: Record<string, unknown>;
  save: (next: Record<string, unknown>) => Promise<unknown>;
  resourceId: string;
  period: string;
  pots: SavingsPot[];
  categoryLimits: CategoryLimits;
  unallocated: number;
  analysis: AnalysisResult;
  // Forecast Income (expected + received) — the basis for the Cap (ADR-0014).
  forecastIncome: number;
  commitments: number;
  cap: number;
}

// One read of everything a budget tool needs. Centralized so no tool has to
// remember that the Cap comes from Forecast Income minus Commitments, or that
// Net Savings excludes pot-funded expenses — getting either wrong is silent.
export const loadBudgetContext = async (
  context: Parameters<typeof openBudgetState>[0]
): Promise<BudgetContext> => {
  const { current, save } = await openBudgetState(context);
  const resourceId = resolveResourceId(context);
  const period = currentPeriod();

  const pots = parsePots(current.savingsPots);
  const categoryLimits = (current.categoryLimits as CategoryLimits | undefined) ?? {};
  const unallocated = typeof current.unallocated === "number" ? current.unallocated : 0;

  const transactions = await listTransactions(resourceId);
  const analysis = computeAnalysis(transactions, categoryLimits, period);

  return {
    current,
    save,
    resourceId,
    period,
    pots,
    categoryLimits,
    unallocated,
    analysis,
    forecastIncome: analysis.forecastIncome,
    commitments: sumCommitments(pots, period),
    cap: computeCap({ forecastIncome: analysis.forecastIncome, pots, period }),
  };
};
