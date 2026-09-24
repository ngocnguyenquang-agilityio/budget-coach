import type { CategoryLimits } from "@/domain/categories";
import { parseAmendments } from "@/domain/budget-state";
import { computeAnalysis } from "@/domain/analysis";
import { computeRefit } from "@/domain/refit";
import { currentPeriod } from "@/domain/period";
import { parsePots } from "@/domain/savings-pot";
import {
  closedPeriodsNeedingBaseline,
  periodsTouched,
  touchesForecastIncome,
  validateCorrections,
  type CorrectableTransaction,
  type CorrectionFailureReason,
  type CorrectionKind,
  type CorrectionRequest,
  type TransactionChanges,
} from "@/domain/transaction-correction";
import { CORRECTION_FAILURE_MESSAGES } from "@/constants/transaction-corrections";
import { deleteTransactionIfUnchanged, listTransactions, updateTransactionIfUnchanged } from "@/db/transactions";
import { parseWorkingMemory } from "@/mastra/lib/parse-working-memory";

export interface AppliedCorrection {
  id: string;
  merchant: string;
  amount: number;
  date: string;
  type: "income" | "expense";
  changes?: TransactionChanges;
}

export interface FailedCorrection {
  id: string;
  merchant: string;
  amount: number;
  reason: CorrectionFailureReason;
  message: string;
}

export interface CorrectionResult {
  kind: CorrectionKind;
  applied: AppliedCorrection[];
  failed: FailedCorrection[];
  // Closed months this changed; the correction lands at the next Monthly
  // Review (ADR-0015) — never a refit.
  amendedPeriods?: string[];
  // Income moved in the current Period and the limits no longer fit the Cap.
  refitNeeded?: boolean;
}

// The User's resource-scoped working memory, read and written by resourceId
// alone. The Coach's working memory is scope: "resource", so no thread is
// involved — a correction made from the dashboard with no chat open is as
// valid as one made from a chat card.
export interface ResourceWorkingMemory {
  get(): Promise<string | null>;
  set(workingMemory: string): Promise<unknown>;
}

// Applies the rows the User confirmed on an edit/delete card (ADR-0016).
// Not a Mastra tool — the Coach has no way to reach this; only the card's
// route does. Every row is re-validated here whatever the model proposed, and
// each succeeds or fails on its own.
export const applyTransactionCorrections = async (
  request: Pick<CorrectionRequest, "kind" | "rows">,
  { resourceId, workingMemory }: { resourceId: string; workingMemory: ResourceWorkingMemory }
): Promise<CorrectionResult> => {
  const state = parseWorkingMemory(await workingMemory.get());
  const today = new Date().toISOString().slice(0, 10);

  const ledger = await listTransactions(resourceId);
  const currentById = new Map<string, CorrectableTransaction>(ledger.map((row) => [row.id, row]));
  const verdicts = validateCorrections(request, currentById, today);

  const failed: FailedCorrection[] = [];
  const fail = (id: string, merchant: string, amount: number, reason: CorrectionFailureReason) =>
    failed.push({ id, merchant, amount, reason, message: CORRECTION_FAILURE_MESSAGES[reason] });

  const candidates = verdicts.flatMap((verdict) => {
    if (verdict.ok) return [verdict];
    fail(verdict.id, verdict.before.merchant, verdict.before.amount, verdict.reason);
    return [];
  });

  // ADR-0015 addendum: the baseline must be read BEFORE anything is written —
  // at this instant a closed Period's Net Savings is exactly what was rolled
  // up when it closed.
  const lastClosed = typeof state.lastClosedPeriod === "string" ? state.lastClosedPeriod : undefined;
  const existingAmendments = parseAmendments(state.pendingAmendments);
  const baselinePeriods = closedPeriodsNeedingBaseline(
    candidates.flatMap(({ current, changes }) => periodsTouched(current, changes)),
    lastClosed,
    existingAmendments
  );
  const limits = (state.categoryLimits as CategoryLimits | undefined) ?? {};
  const baselines = new Map(
    baselinePeriods.map((period) => [period, computeAnalysis(ledger, limits, period).netSavings])
  );

  const applied: (AppliedCorrection & { current: CorrectableTransaction })[] = [];
  for (const { id, before, current, changes } of candidates) {
    try {
      const written =
        request.kind === "delete"
          ? await deleteTransactionIfUnchanged(resourceId, id, before)
          : await updateTransactionIfUnchanged(resourceId, id, before, changes ?? {});
      if (!written) {
        fail(id, before.merchant, before.amount, "stale");
        continue;
      }
      applied.push({
        id,
        merchant: changes?.merchant ?? before.merchant,
        amount: changes?.amount ?? before.amount,
        date: changes?.date ?? before.date,
        type: before.type,
        ...(changes ? { changes } : {}),
        current,
      });
    } catch {
      fail(id, before.merchant, before.amount, "write_failed");
    }
  }

  // Only Periods an applied row actually touched get flagged — a row that
  // failed never changed that Period's ledger.
  const amendedPeriods = [
    ...new Set(
      applied.flatMap(({ current, changes }) => periodsTouched(current, changes)).filter((period) => baselines.has(period))
    ),
  ];
  if (amendedPeriods.length > 0) {
    await workingMemory.set(
      JSON.stringify({
        ...state,
        pendingAmendments: [
          ...existingAmendments,
          ...amendedPeriods.map((period) => ({ period, netSavingsAtClose: baselines.get(period)! })),
        ],
      })
    );
  }

  // Read the ledger again after the writes, so the Cap reflects the new
  // Forecast Income. Same inputs loadBudgetContext hands confirmTransactionTool.
  let refitNeeded = false;
  const period = currentPeriod();
  if (touchesForecastIncome(applied, period)) {
    const { forecastIncome } = computeAnalysis(await listTransactions(resourceId), limits, period);
    refitNeeded =
      computeRefit({ forecastIncome, pots: parsePots(state.savingsPots), categoryLimits: limits, period }).outcome ===
      "cuts";
  }

  return {
    kind: request.kind,
    applied: applied.map(({ current: _current, ...rest }) => rest),
    failed,
    ...(amendedPeriods.length > 0 ? { amendedPeriods } : {}),
    ...(refitNeeded ? { refitNeeded } : {}),
  };
};
