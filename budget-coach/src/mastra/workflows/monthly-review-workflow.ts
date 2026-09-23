import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { CategorySchema } from "@/domain/categories";
import { AnalysisResultSchema, computeAnalysis } from "@/domain/analysis";
import { proposeCategoryLimits, scaleLimitsToCap } from "@/domain/propose-limits";
import { computeCap } from "@/domain/commitment";
import { computePeriodClose, applyPeriodClose, computeAmendments } from "@/domain/period-close";
import { SavingsPotSchema } from "@/domain/savings-pot";
import { currentPeriod, unclosedPeriods } from "@/domain/period";
import { expireExpectedTransactions, listTransactions } from "@/db/transactions";
import { parsePots } from "@/mastra/lib/budget-context";
import { parseWorkingMemory } from "@/mastra/lib/parse-working-memory";
import { parseAmendments } from "@/domain/budget-state";
import { adjustmentReasonablenessScorer } from "@/mastra/scorers/adjustment-reasonableness";

// partialRecord, not record — see src/mastra/tools/analyze-transactions.ts for
// why Zod v4's z.record with an enum key schema doesn't fit here.
const CategoryLimitsSchema = z.partialRecord(CategorySchema, z.number());

const PotAllocationSchema = z.object({
  potId: z.string(),
  potName: z.string(),
  amount: z.number(),
});

// One finished Period's roll-up: its signed Net Savings landing in Unallocated
// and being drawn down by each pot's rate (ADR-0012).
export const PeriodCloseSchema = z.object({
  period: z.string(),
  netSavings: z.number(),
  availableToAllocate: z.number(),
  allocations: z.array(PotAllocationSchema),
  remainingUnallocated: z.number(),
});

// A correction to an already-closed Period's Net Savings, caused by a
// Transaction backdated into it after the fact (ADR-0015). Folded into
// Unallocated only — pot allocations from the original close are never
// replayed.
export const PeriodAmendmentSchema = z.object({
  period: z.string(),
  previousNetSavings: z.number(),
  revisedNetSavings: z.number(),
  delta: z.number(),
});

// Shared by every step as both inputSchema and outputSchema, so resourceId
// (and the bookkeeping threadId used for Coach working-memory reads/writes)
// flows through the whole pipeline unchanged.
// Exported so adjustmentReasonablenessScorer can type its run.input/run.output
// against the same shape the proposeAdjustments step actually reads.
export const reviewSchema = z.object({
  resourceId: z.string(),
  threadId: z.string(),
  categoryLimits: CategoryLimitsSchema.optional(),
  analysis: AnalysisResultSchema.optional(),
  proposedLimits: CategoryLimitsSchema.optional(),
  pots: z.array(SavingsPotSchema).optional(),
  unallocated: z.number().optional(),
  periodCloses: z.array(PeriodCloseSchema).optional(),
  amendments: z.array(PeriodAmendmentSchema).optional(),
  // Forecast Income − Commitments (ADR-0014) — threaded through so the
  // approval gate can show it and applyOrDiscard can re-check edits.
  cap: z.number().optional(),
  commitments: z.number().optional(),
  decision: z.enum(["approve", "reject"]).optional(),
  edits: CategoryLimitsSchema.optional(),
  allocationEdits: z.array(PotAllocationSchema).optional(),
});

// The proposals shown to the user at the approval gate — shared between the
// gate's own suspendSchema and the Coach's approveBudgetTool, which relays
// this payload verbatim when it suspends.
export const MonthlyReviewSuspendSchema = z.object({
  proposedLimits: CategoryLimitsSchema,
  analysis: AnalysisResultSchema,
  cap: z.number().optional(),
  commitments: z.number().optional(),
  periodCloses: z.array(PeriodCloseSchema).default([]),
  amendments: z.array(PeriodAmendmentSchema).default([]),
  // Discriminator so the frontend's single coach useInterrupt picks the right
  // approval card (mirrors RefitSuspendSchema's "refit").
  kind: z.literal("monthly-review").default("monthly-review"),
});

export const MonthlyReviewResumeSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  edits: CategoryLimitsSchema.optional(),
  // User-adjusted Period Close allocations; absent means "as proposed".
  allocationEdits: z.array(PotAllocationSchema).optional(),
});

const outputSchema = z.object({
  status: z.enum(["applied", "discarded"]),
  categoryLimits: CategoryLimitsSchema,
  closedPeriods: z.array(z.string()).default([]),
});

const emptyAnalysis = {
  categoryTotals: [],
  expenseTotal: 0,
  committedExpenseTotal: 0,
  receivedIncome: 0,
  forecastIncome: 0,
  netSavings: 0,
};

// Period Close (ADR-0012): every Period finished since the last close, in
// order. A skipped month defers its close rather than losing it, so this can
// legitimately produce several at once — the approval card renders them all.
const closePeriods = createStep({
  id: "close-periods",
  description: "Proposes the roll-up of each unclosed Period's Net Savings into the Savings Balance.",
  inputSchema: reviewSchema,
  outputSchema: reviewSchema,
  execute: async ({ inputData, mastra }) => {
    const { resourceId, threadId } = inputData;

    const coachAgent = mastra?.getAgent("coach");
    const memory = await coachAgent?.getMemory();
    const raw = memory ? await memory.getWorkingMemory({ threadId, resourceId }) : null;
    const memoryState = parseWorkingMemory(raw);

    const pots = parsePots(memoryState.savingsPots);
    const categoryLimits = (memoryState.categoryLimits as z.infer<typeof CategoryLimitsSchema> | undefined) ?? {};
    const lastClosed = memoryState.lastClosedPeriod as string | undefined;
    let unallocated = typeof memoryState.unallocated === "number" ? memoryState.unallocated : 0;

    const transactions = await listTransactions(resourceId);
    const periods = unclosedPeriods(lastClosed, currentPeriod());

    // A Transaction backdated into an already-closed Period (ADR-0015): fold
    // the correction into Unallocated BEFORE the close loop, so it flows into
    // pots through this Period's own pro-rata allocation and into the
    // post-close pots the Cap below is derived from — no separate mechanism.
    const pendingAmendments = parseAmendments(memoryState.pendingAmendments);
    const amendments = computeAmendments({
      pending: pendingAmendments,
      revisedNetSavings: (period) => computeAnalysis(transactions, categoryLimits, period).netSavings,
    });
    unallocated = Math.round((unallocated + amendments.reduce((total, a) => total + a.delta, 0)) * 100) / 100;

    // Each close feeds the next: a pot filled in March has less room in April,
    // so they're computed in sequence against a running pot/unallocated state.
    let runningPots = pots;
    const periodCloses = [];

    for (const period of periods) {
      const analysis = computeAnalysis(transactions, categoryLimits, period);
      const close = computePeriodClose({
        period,
        netSavings: analysis.netSavings,
        unallocated,
        pots: runningPots,
      });
      const applied = applyPeriodClose(runningPots, close.allocations, close.availableToAllocate);
      runningPots = applied.pots;
      unallocated = applied.unallocated;
      periodCloses.push(close);
    }

    // Return the POST-close pots, not the ones read from memory: a target pot
    // these closes would fill has its rate drop to zero, which raises the Cap.
    // Proposing limits against pre-close balances would show the user a Cap
    // that contradicts the roll-up shown on the very same approval card.
    return { ...inputData, categoryLimits, pots: runningPots, periodCloses, amendments, unallocated };
  },
});

const analyzeSpending = createStep({
  id: "analyze-spending",
  description: "Computes per-category totals and trailing received spend against the current category limits.",
  inputSchema: reviewSchema,
  outputSchema: reviewSchema,
  execute: async ({ inputData }) => {
    const { resourceId, categoryLimits } = inputData;

    const transactions = await listTransactions(resourceId);
    const period = currentPeriod();
    const analysis = computeAnalysis(transactions, categoryLimits ?? {}, period);

    // No income on record means there is nothing to take a share of, so the
    // proposal runs uncapped rather than against a cap of zero (which
    // proposeCategoryLimits rightly refuses). approveBudgetTool blocks this
    // case before the workflow starts; this keeps a direct run — Mastra
    // Studio, a test — from failing instead of degrading.
    const cap =
      analysis.forecastIncome > 0
        ? computeCap({ forecastIncome: analysis.forecastIncome, pots: inputData.pots ?? [], period })
        : undefined;

    return {
      ...inputData,
      analysis,
      cap,
      ...(cap !== undefined
        ? { commitments: Math.round((analysis.forecastIncome - cap) * 100) / 100 }
        : {}),
    };
  },
});

const proposeAdjustments = createStep({
  id: "propose-adjustments",
  description: "Proposes new category limits at ~110% of trailing received spend, scaled to fit the Cap.",
  inputSchema: reviewSchema,
  outputSchema: reviewSchema,
  scorers: {
    adjustmentReasonableness: {
      scorer: adjustmentReasonablenessScorer,
      sampling: { type: "ratio", rate: 1 },
    },
  },
  execute: async ({ inputData }: { inputData: z.infer<typeof reviewSchema> }) => {
    const analysis = inputData.analysis ?? emptyAnalysis;
    const proposedLimits = proposeCategoryLimits(analysis, inputData.cap);
    return { ...inputData, proposedLimits };
  },
});

const approvalGate = createStep({
  id: "approval-gate",
  description: "Suspends until the user approves or rejects the proposed limits and Period Close.",
  inputSchema: reviewSchema,
  outputSchema: reviewSchema,
  suspendSchema: MonthlyReviewSuspendSchema,
  resumeSchema: MonthlyReviewResumeSchema,
  execute: async ({ inputData, resumeData, suspend, mastra, runId }) => {
    if (!resumeData) {
      // Record which run is pending so approveBudgetTool can find it again
      // from a later, separate tool call (suspend/resume happen as two
      // different requests).
      const coachAgent = mastra?.getAgent("coach");
      const memory = await coachAgent?.getMemory();
      if (memory) {
        const raw = await memory.getWorkingMemory({ threadId: inputData.threadId, resourceId: inputData.resourceId });
        const current = parseWorkingMemory(raw);
        await memory.updateWorkingMemory({
          threadId: inputData.threadId,
          resourceId: inputData.resourceId,
          workingMemory: JSON.stringify({
            ...current,
            pendingApproval: { runId, workflow: "monthly-review", createdAt: new Date().toISOString() },
          }),
        });
      }

      // return suspend(...), never await suspend() — awaiting it lets the
      // run continue past this point without actually waiting for resume.
      return suspend({
        proposedLimits: inputData.proposedLimits ?? {},
        analysis: inputData.analysis ?? emptyAnalysis,
        cap: inputData.cap,
        commitments: inputData.commitments,
        periodCloses: inputData.periodCloses ?? [],
        amendments: inputData.amendments ?? [],
        kind: "monthly-review",
      });
    }

    return {
      ...inputData,
      decision: resumeData.decision,
      edits: resumeData.edits,
      allocationEdits: resumeData.allocationEdits,
    };
  },
});

const applyOrDiscard = createStep({
  id: "apply-or-discard",
  description: "Persists the approved limits and Period Close (or discards the proposal) into Coach working memory.",
  inputSchema: reviewSchema,
  outputSchema,
  execute: async ({ inputData, mastra }) => {
    const { resourceId, threadId, decision, proposedLimits, edits, categoryLimits, periodCloses, amendments } =
      inputData;

    const approved = decision === "approve";
    const status: "applied" | "discarded" = approved ? "applied" : "discarded";
    const mergedLimits = approved ? { ...(proposedLimits ?? {}), ...(edits ?? {}) } : (categoryLimits ?? {});

    // Defense in depth: the review card already disables Approve once the
    // user's edited total exceeds the Cap, but this is the point where
    // categoryLimits is actually persisted — re-enforce ADR-0014's invariant
    // here too rather than trusting resumeData unconditionally.
    const cap = inputData.cap;
    const mergedSum = Object.values(mergedLimits).reduce((total, value) => total + (value ?? 0), 0);
    const nextLimits = approved && cap !== undefined && mergedSum > cap ? scaleLimitsToCap(mergedLimits, cap) : mergedLimits;

    const closes = periodCloses ?? [];
    const closedPeriods = approved ? closes.map((close) => close.period) : [];

    const coachAgent = mastra?.getAgent("coach");
    const memory = await coachAgent?.getMemory();
    if (memory) {
      const raw = await memory.getWorkingMemory({ threadId, resourceId });
      const current = parseWorkingMemory(raw);

      let pots = parsePots(current.savingsPots);
      let unallocated = typeof current.unallocated === "number" ? current.unallocated : 0;

      if (approved) {
        // Fold in the same amendment delta closePeriods showed on the
        // approval card, against this fresh read of Unallocated — mirrors
        // closePeriods' own fold-before-close ordering (ADR-0015).
        unallocated = Math.round(
          (unallocated + (amendments ?? []).reduce((total, a) => total + a.delta, 0)) * 100
        ) / 100;

        for (const close of closes) {
          // User edits replace that Period's proposal wholesale; absent means
          // "as proposed" (ADR-0013's confirm-or-edit at Period Close).
          const allocations =
            inputData.allocationEdits && close === closes[closes.length - 1]
              ? inputData.allocationEdits
              : close.allocations;
          const available = Math.round((unallocated + close.netSavings) * 100) / 100;
          const applied = applyPeriodClose(pots, allocations, available);
          pots = applied.pots;
          unallocated = applied.unallocated;
        }
      }

      // Only an APPROVED run resolves an amendment (its delta is folded into
      // Unallocated above) — a rejection leaves pendingAmendments untouched,
      // same as a rejected close leaves lastClosedPeriod untouched, so the
      // correction reappears at the next review rather than being lost.
      // Filtered from this fresh `current` read, not `inputData`, so a
      // period backdated into while this approval was suspended isn't
      // dropped (ADR-0015).
      const evaluatedPeriods = new Set((amendments ?? []).map((a) => a.period));
      const remainingAmendments = parseAmendments(current.pendingAmendments).filter(
        (entry) => !evaluatedPeriods.has(entry.period)
      );

      await memory.updateWorkingMemory({
        threadId,
        resourceId,
        workingMemory: JSON.stringify({
          ...current,
          ...(approved ? { categoryLimits: nextLimits, savingsPots: pots, unallocated } : {}),
          ...(approved && closedPeriods.length > 0
            ? { lastClosedPeriod: closedPeriods[closedPeriods.length - 1] }
            : {}),
          ...(approved && evaluatedPeriods.size > 0 ? { pendingAmendments: remainingAmendments } : {}),
          // Only an approved review completes the month. A rejection defers
          // it — same as the close and amendments above — so the user can run
          // the review again rather than being locked out until next month.
          ...(approved ? { lastReviewPeriod: currentPeriod() } : {}),
          pendingApproval: null,
        }),
      });

      // An unconfirmed forecast doesn't survive its Period (ADR-0011).
      // Deleted only after the close above is saved: if that save fails, the
      // Periods stay open and their expected rows must still be there.
      for (const period of closedPeriods) {
        await expireExpectedTransactions(resourceId, period);
      }
    }

    return { status, categoryLimits: nextLimits, closedPeriods };
  },
});

export const monthlyReviewWorkflow = createWorkflow({
  id: "monthly-review-workflow",
  inputSchema: reviewSchema,
  outputSchema,
})
  .then(closePeriods)
  .then(analyzeSpending)
  .then(proposeAdjustments)
  .then(approvalGate)
  .then(applyOrDiscard);

monthlyReviewWorkflow.commit();
