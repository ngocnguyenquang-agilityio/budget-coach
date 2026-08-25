import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { CategorySchema, type Category } from "@/domain/categories";
import { AnalysisResultSchema, computeAnalysis } from "@/domain/analysis";
import { proposeCategoryLimits } from "@/domain/propose-limits";
import { listTransactions } from "@/db/transactions";
import { parseWorkingMemory } from "@/mastra/parse-working-memory";
import { adjustmentReasonablenessScorer } from "@/mastra/scorers/adjustment-reasonableness";

// partialRecord, not record — see src/mastra/tools/analyze-transactions.ts for
// why Zod v4's z.record with an enum key schema doesn't fit here.
const CategoryLimitsSchema = z.partialRecord(CategorySchema, z.number());

// Shared by every step as both inputSchema and outputSchema, so resourceId
// (and the bookkeeping threadId used for Coach working-memory reads/writes)
// flows through the whole pipeline unchanged.
// Exported so adjustmentReasonablenessScorer (src/mastra/scorers/adjustment-reasonableness.ts)
// can type its run.input/run.output against the same shape the
// proposeAdjustments step actually reads and returns.
export const reviewSchema = z.object({
  resourceId: z.string(),
  threadId: z.string(),
  categoryLimits: CategoryLimitsSchema.optional(),
  savingsGoal: z.number().optional(),
  declaredIncome: z.number().optional(),
  analysis: AnalysisResultSchema.optional(),
  proposedLimits: CategoryLimitsSchema.optional(),
  // Declared Income − Savings Goal (ADR-0007) — threaded through from
  // proposeAdjustments so the approval gate can hand it to the user, and
  // applyOrDiscard can re-check edits against it below.
  cap: z.number().optional(),
  decision: z.enum(["approve", "reject"]).optional(),
  edits: CategoryLimitsSchema.optional(),
});

// The proposals shown to the user at the approval gate — shared between the
// gate's own suspendSchema and the Coach's approveBudgetTool, which relays
// this payload verbatim when it suspends.
export const MonthlyReviewSuspendSchema = z.object({
  proposedLimits: CategoryLimitsSchema,
  analysis: AnalysisResultSchema,
  cap: z.number().optional(),
});

export const MonthlyReviewResumeSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  edits: CategoryLimitsSchema.optional(),
});

const outputSchema = z.object({
  status: z.enum(["applied", "discarded"]),
  categoryLimits: CategoryLimitsSchema,
});

// Every transaction gets a category at insert time (src/db/transactions.ts),
// so there is currently nothing for this step to do — it exists to hold this
// pipeline position per the spec.
const categorizeUncategorized = createStep({
  id: "categorize-uncategorized",
  description: "Categorizes any transactions missing a category before analysis runs.",
  inputSchema: reviewSchema,
  outputSchema: reviewSchema,
  execute: async ({ inputData }) => {
    return inputData;
  },
});

const analyzeSpending = createStep({
  id: "analyze-spending",
  description: "Computes per-category totals and trailing spend against the current category limits.",
  inputSchema: reviewSchema,
  outputSchema: reviewSchema,
  execute: async ({ inputData, mastra }) => {
    const { resourceId, threadId } = inputData;

    const coachAgent = mastra?.getAgent("coach");
    const memory = await coachAgent?.getMemory();
    const raw = memory ? await memory.getWorkingMemory({ threadId, resourceId }) : null;
    const memoryState = parseWorkingMemory(raw);
    const categoryLimits = (memoryState.categoryLimits as z.infer<typeof CategoryLimitsSchema> | undefined) ?? {};
    const savingsGoal = memoryState.savingsGoal as number | undefined;
    const declaredIncome = memoryState.declaredIncome as number | undefined;

    const transactions = await listTransactions(resourceId);
    const period = new Date().toISOString().slice(0, 7);
    const analysis = computeAnalysis(transactions, categoryLimits, period);

    return { ...inputData, categoryLimits, savingsGoal, declaredIncome, analysis };
  },
});

const proposeAdjustments = createStep({
  id: "propose-adjustments",
  description: "Proposes new category limits at ~110% of trailing spend — same formula for a first run or a later adjustment.",
  inputSchema: reviewSchema,
  outputSchema: reviewSchema,
  scorers: {
    adjustmentReasonableness: {
      scorer: adjustmentReasonablenessScorer,
      sampling: { type: "ratio", rate: 1 },
    },
  },
  execute: async ({ inputData }: { inputData: z.infer<typeof reviewSchema> }) => {
    const analysis = inputData.analysis ?? { categoryTotals: [], expenseTotal: 0, incomeTotal: 0, netSavings: 0 };
    const cap =
      inputData.declaredIncome !== undefined && inputData.savingsGoal !== undefined
        ? inputData.declaredIncome - inputData.savingsGoal
        : undefined;
    const proposedLimits = proposeCategoryLimits(analysis, cap);
    return { ...inputData, proposedLimits, cap };
  },
});

const approvalGate = createStep({
  id: "approval-gate",
  description: "Suspends until the user approves or rejects the proposed category limits.",
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
          workingMemory: JSON.stringify({ ...current, pendingApproval: { runId } }),
        });
      }

      // return suspend(...), never await suspend() — awaiting it lets the
      // run continue past this point without actually waiting for resume.
      return suspend({
        proposedLimits: inputData.proposedLimits ?? {},
        analysis: inputData.analysis ?? { categoryTotals: [], expenseTotal: 0, incomeTotal: 0, netSavings: 0 },
        cap: inputData.cap,
      });
    }

    return { ...inputData, decision: resumeData.decision, edits: resumeData.edits };
  },
});

const applyOrDiscard = createStep({
  id: "apply-or-discard",
  description: "Persists the approved limits (or discards the proposal) into Coach working memory.",
  inputSchema: reviewSchema,
  outputSchema,
  execute: async ({ inputData, mastra }) => {
    const { resourceId, threadId, decision, proposedLimits, edits, categoryLimits } = inputData;

    const approved = decision === "approve";
    const status: "applied" | "discarded" = approved ? "applied" : "discarded";
    const mergedLimits = approved ? { ...(proposedLimits ?? {}), ...(edits ?? {}) } : (categoryLimits ?? {});

    // Defense in depth: the review card already disables Approve once the
    // user's edited total exceeds cap, but this is the point where
    // categoryLimits is actually persisted — re-enforce ADR-0007's invariant
    // here too rather than trusting resumeData unconditionally.
    const cap = inputData.cap;
    const mergedSum = Object.values(mergedLimits).reduce((total, value) => total + (value ?? 0), 0);
    const nextLimits =
      approved && cap !== undefined && mergedSum > cap
        ? Object.fromEntries(
            (Object.keys(mergedLimits) as Category[]).map((category) => [
              category,
              Math.round(((mergedLimits[category] ?? 0) * cap) / mergedSum * 100) / 100,
            ]),
          )
        : mergedLimits;

    const coachAgent = mastra?.getAgent("coach");
    const memory = await coachAgent?.getMemory();
    if (memory) {
      const raw = await memory.getWorkingMemory({ threadId, resourceId });
      const current = parseWorkingMemory(raw);
      const next = {
        ...current,
        ...(approved ? { categoryLimits: nextLimits } : {}),
        lastReviewPeriod: new Date().toISOString().slice(0, 7),
        pendingApproval: undefined,
      };
      await memory.updateWorkingMemory({ threadId, resourceId, workingMemory: JSON.stringify(next) });
    }

    return { status, categoryLimits: nextLimits };
  },
});

export const monthlyReviewWorkflow = createWorkflow({
  id: "monthly-review-workflow",
  inputSchema: reviewSchema,
  outputSchema,
})
  .then(categorizeUncategorized)
  .then(analyzeSpending)
  .then(proposeAdjustments)
  .then(approvalGate)
  .then(applyOrDiscard);

monthlyReviewWorkflow.commit();
