import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { CategorySchema } from "@/domain/categories";
import { AnalysisResultSchema, computeAnalysis } from "@/domain/analysis";
import { computeRefit } from "@/domain/refit";
import { scaleLimitsToCap } from "@/domain/propose-limits";
import { sumCommitments } from "@/domain/commitment";
import { currentPeriod } from "@/domain/period";
import { listTransactions } from "@/db/transactions";
import { parsePots } from "@/mastra/lib/budget-context";
import { parseWorkingMemory } from "@/mastra/lib/parse-working-memory";

// partialRecord, not record — see monthly-review-workflow.ts.
const CategoryLimitsSchema = z.partialRecord(CategorySchema, z.number());

const refitSchema = z.object({
  resourceId: z.string(),
  threadId: z.string(),
  categoryLimits: CategoryLimitsSchema.optional(),
  analysis: AnalysisResultSchema.optional(),
  outcome: z.enum(["impossible", "fits", "cuts"]).optional(),
  cap: z.number().optional(),
  commitments: z.number().optional(),
  forecastIncome: z.number().optional(),
  proposedLimits: CategoryLimitsSchema.optional(),
  decision: z.enum(["approve", "reject"]).optional(),
  edits: CategoryLimitsSchema.optional(),
});

// Shown at the approval gate — relayed verbatim by refitBudgetTool when it
// suspends. `kind` is the discriminator the frontend's single coach
// useInterrupt reads to pick the RefitCard over the MonthlyReviewCard.
export const RefitSuspendSchema = z.object({
  proposedLimits: CategoryLimitsSchema,
  currentLimits: CategoryLimitsSchema,
  analysis: AnalysisResultSchema,
  cap: z.number(),
  commitments: z.number(),
  kind: z.literal("refit").default("refit"),
});

export const RefitResumeSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  edits: CategoryLimitsSchema.optional(),
});

const outputSchema = z.object({
  status: z.enum(["applied", "discarded", "fits", "impossible"]),
  categoryLimits: CategoryLimitsSchema,
  cap: z.number().optional(),
});

const readLedger = createStep({
  id: "read-ledger",
  description: "Reads the Commitment ledger and current Category Limits, and computes the Period's analysis.",
  inputSchema: refitSchema,
  outputSchema: refitSchema,
  execute: async ({ inputData, mastra }) => {
    const { resourceId, threadId } = inputData;

    const coachAgent = mastra?.getAgent("coach");
    const memory = await coachAgent?.getMemory();
    const raw = memory ? await memory.getWorkingMemory({ threadId, resourceId }) : null;
    const memoryState = parseWorkingMemory(raw);
    const categoryLimits = (memoryState.categoryLimits as z.infer<typeof CategoryLimitsSchema> | undefined) ?? {};

    const transactions = await listTransactions(resourceId);
    const period = currentPeriod();
    const analysis = computeAnalysis(transactions, categoryLimits, period);

    return {
      ...inputData,
      categoryLimits,
      analysis,
      forecastIncome: analysis.forecastIncome,
      commitments: sumCommitments(parsePots(memoryState.savingsPots), period),
    };
  },
});

const proposeRefit = createStep({
  id: "propose-refit",
  description: "Recomputes the Cap and scales Category Limits down to fit beneath it when they no longer do.",
  inputSchema: refitSchema,
  outputSchema: refitSchema,
  execute: async ({ inputData, mastra }) => {
    const { resourceId, threadId } = inputData;

    const coachAgent = mastra?.getAgent("coach");
    const memory = await coachAgent?.getMemory();
    const raw = memory ? await memory.getWorkingMemory({ threadId, resourceId }) : null;
    const pots = parsePots(parseWorkingMemory(raw).savingsPots);

    const refit = computeRefit({
      forecastIncome: inputData.forecastIncome ?? 0,
      pots,
      categoryLimits: inputData.categoryLimits ?? {},
      period: currentPeriod(),
    });

    if (refit.outcome === "cuts") {
      return { ...inputData, outcome: refit.outcome, cap: refit.cap, proposedLimits: refit.proposedLimits };
    }
    return { ...inputData, outcome: refit.outcome, cap: refit.cap };
  },
});

const approvalGate = createStep({
  id: "approval-gate",
  description: "Suspends for approval only when cuts are proposed; passes through otherwise.",
  inputSchema: refitSchema,
  outputSchema: refitSchema,
  suspendSchema: RefitSuspendSchema,
  resumeSchema: RefitResumeSchema,
  execute: async ({ inputData, resumeData, suspend, mastra, runId }) => {
    if (inputData.outcome !== "cuts") return inputData;

    if (!resumeData) {
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
            pendingApproval: { runId, workflow: "refit", createdAt: new Date().toISOString() },
          }),
        });
      }

      // return suspend(...), never await suspend().
      return suspend({
        proposedLimits: inputData.proposedLimits ?? {},
        currentLimits: inputData.categoryLimits ?? {},
        analysis:
          inputData.analysis ?? {
            categoryTotals: [],
            expenseTotal: 0,
            committedExpenseTotal: 0,
            receivedIncome: 0,
            forecastIncome: 0,
            netSavings: 0,
          },
        cap: inputData.cap ?? 0,
        commitments: inputData.commitments ?? 0,
        kind: "refit",
      });
    }

    return { ...inputData, decision: resumeData.decision, edits: resumeData.edits };
  },
});

const applyOrDiscard = createStep({
  id: "apply-or-discard",
  description: "Persists approved limits, or reports a non-suspending outcome.",
  inputSchema: refitSchema,
  outputSchema,
  execute: async ({ inputData, mastra }) => {
    const { resourceId, threadId, outcome, categoryLimits, cap } = inputData;

    if (outcome !== "cuts") {
      return {
        status: outcome === "impossible" ? ("impossible" as const) : ("fits" as const),
        categoryLimits: categoryLimits ?? {},
        cap,
      };
    }

    const approved = inputData.decision === "approve";
    const status: "applied" | "discarded" = approved ? "applied" : "discarded";
    const mergedLimits = approved
      ? { ...(inputData.proposedLimits ?? {}), ...(inputData.edits ?? {}) }
      : (categoryLimits ?? {});

    // Defense in depth: the card disables Approve once the edited total
    // exceeds the Cap, but re-enforce it here where limits are persisted.
    const mergedSum = Object.values(mergedLimits).reduce((total, value) => total + (value ?? 0), 0);
    const nextLimits = approved && cap !== undefined && mergedSum > cap ? scaleLimitsToCap(mergedLimits, cap) : mergedLimits;

    const coachAgent = mastra?.getAgent("coach");
    const memory = await coachAgent?.getMemory();
    if (memory) {
      const raw = await memory.getWorkingMemory({ threadId, resourceId });
      const current = parseWorkingMemory(raw);
      await memory.updateWorkingMemory({
        threadId,
        resourceId,
        workingMemory: JSON.stringify({
          ...current,
          ...(approved ? { categoryLimits: nextLimits } : {}),
          pendingApproval: null,
        }),
      });
    }

    return { status, categoryLimits: nextLimits, cap };
  },
});

// The forward-looking counterpart to the Monthly Review. Runs when the
// Commitment ledger changes (ADR-0014) — a pot created or edited, income
// revised, or a Period boundary crossed — not on a user's request.
export const refitWorkflow = createWorkflow({
  id: "refit-workflow",
  inputSchema: refitSchema,
  outputSchema,
})
  .then(readLedger)
  .then(proposeRefit)
  .then(approvalGate)
  .then(applyOrDiscard);

refitWorkflow.commit();
