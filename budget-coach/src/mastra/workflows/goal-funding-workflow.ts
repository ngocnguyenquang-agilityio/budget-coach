import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { CategorySchema, type Category } from "@/domain/categories";
import { AnalysisResultSchema, computeAnalysis } from "@/domain/analysis";
import { TargetSchema, computeFundingPlan } from "@/domain/funding-plan";
import { scaleLimitsToCap } from "@/domain/propose-limits";
import { listTransactions } from "@/db/transactions";
import { parseWorkingMemory } from "@/mastra/lib/parse-working-memory";

// partialRecord, not record — see monthly-review-workflow.ts / analyze-transactions.ts.
const CategoryLimitsSchema = z.partialRecord(CategorySchema, z.number());

// Shared by every step as both input and output schema, carrying the Target
// and the computed plan through the pipeline (mirrors reviewSchema).
const fundingSchema = z.object({
  resourceId: z.string(),
  threadId: z.string(),
  target: TargetSchema,
  declaredIncome: z.number().optional(),
  categoryLimits: CategoryLimitsSchema.optional(),
  analysis: AnalysisResultSchema.optional(),
  outcome: z.enum(["infeasible", "fits", "cuts"]).optional(),
  requiredPerMonth: z.number().optional(),
  cap: z.number().optional(),
  proposedLimits: CategoryLimitsSchema.optional(),
  decision: z.enum(["approve", "reject"]).optional(),
  edits: CategoryLimitsSchema.optional(),
});

// Shown at the approval gate — shared with plan-funding.ts's planFundingTool,
// which relays this payload verbatim when it suspends. `kind` is the
// discriminator the frontend's single coach useInterrupt reads to pick the
// FundingPlanCard over the MonthlyReviewCard.
export const FundingPlanSuspendSchema = z.object({
  proposedLimits: CategoryLimitsSchema,
  analysis: AnalysisResultSchema,
  cap: z.number().optional(),
  target: TargetSchema,
  requiredPerMonth: z.number(),
  kind: z.literal("funding-plan").default("funding-plan"),
});

export const FundingPlanResumeSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  edits: CategoryLimitsSchema.optional(),
});

const outputSchema = z.object({
  // "applied"/"discarded" come from the approval gate; "on-track" (savings
  // already within Capacity — goal set, no card) and "fits-purchase" (affordable
  // now) and "infeasible" (required ≥ declared income) skip the gate entirely.
  status: z.enum(["applied", "discarded", "on-track", "fits-purchase", "infeasible"]),
  categoryLimits: CategoryLimitsSchema,
  requiredPerMonth: z.number().optional(),
  declaredIncome: z.number().optional(),
});

// Thin entry step, symmetric with the Monthly Review's categorizeUncategorized
// — validates the Target rode through and holds this pipeline position.
const resolveTarget = createStep({
  id: "resolve-target",
  description: "Validates the funding Target before capacity analysis runs.",
  inputSchema: fundingSchema,
  outputSchema: fundingSchema,
  execute: async ({ inputData }) => inputData,
});

const analyzeCapacity = createStep({
  id: "analyze-capacity",
  description: "Reads Declared Income and current Category Limits, and computes the analysis shown on the approval card.",
  inputSchema: fundingSchema,
  outputSchema: fundingSchema,
  execute: async ({ inputData, mastra }) => {
    const { resourceId, threadId } = inputData;

    const coachAgent = mastra?.getAgent("coach");
    const memory = await coachAgent?.getMemory();
    const raw = memory ? await memory.getWorkingMemory({ threadId, resourceId }) : null;
    const memoryState = parseWorkingMemory(raw);
    const categoryLimits = (memoryState.categoryLimits as z.infer<typeof CategoryLimitsSchema> | undefined) ?? {};
    const declaredIncome = memoryState.declaredIncome as number | undefined;

    const transactions = await listTransactions(resourceId);
    const period = new Date().toISOString().slice(0, 7);
    const analysis = computeAnalysis(transactions, categoryLimits, period);

    return { ...inputData, categoryLimits, declaredIncome, analysis };
  },
});

const proposeReallocation = createStep({
  id: "propose-reallocation",
  description: "Runs the feasibility math: infeasible, already fits, or proposes proportional cuts to fund the Target.",
  inputSchema: fundingSchema,
  outputSchema: fundingSchema,
  execute: async ({ inputData }) => {
    const period = new Date().toISOString().slice(0, 7);
    // declaredIncome is guaranteed set by planFundingTool before the workflow
    // starts; the ?? 0 fallback degrades to "infeasible" rather than throwing.
    const plan = computeFundingPlan({
      declaredIncome: inputData.declaredIncome ?? 0,
      categoryLimits: inputData.categoryLimits ?? {},
      target: inputData.target,
      period,
    });

    if (plan.outcome === "cuts") {
      return { ...inputData, outcome: plan.outcome, requiredPerMonth: plan.requiredPerMonth, cap: plan.cap, proposedLimits: plan.proposedLimits };
    }
    return { ...inputData, outcome: plan.outcome, requiredPerMonth: plan.requiredPerMonth };
  },
});

const approvalGate = createStep({
  id: "approval-gate",
  description: "Suspends for approval only when cuts are proposed; passes through otherwise.",
  inputSchema: fundingSchema,
  outputSchema: fundingSchema,
  suspendSchema: FundingPlanSuspendSchema,
  resumeSchema: FundingPlanResumeSchema,
  execute: async ({ inputData, resumeData, suspend, mastra, runId }) => {
    // No cuts to approve (infeasible / already fits) — flow straight to apply.
    if (inputData.outcome !== "cuts") {
      return inputData;
    }

    if (!resumeData) {
      const coachAgent = mastra?.getAgent("coach");
      const memory = await coachAgent?.getMemory();
      if (memory) {
        const raw = await memory.getWorkingMemory({ threadId: inputData.threadId, resourceId: inputData.resourceId });
        const current = parseWorkingMemory(raw);
        await memory.updateWorkingMemory({
          threadId: inputData.threadId,
          resourceId: inputData.resourceId,
          workingMemory: JSON.stringify({ ...current, pendingApproval: { runId, workflow: "funding-plan" } }),
        });
      }

      // return suspend(...), never await suspend().
      return suspend({
        proposedLimits: inputData.proposedLimits ?? {},
        analysis: inputData.analysis ?? { categoryTotals: [], expenseTotal: 0, incomeTotal: 0, netSavings: 0 },
        cap: inputData.cap,
        target: inputData.target,
        requiredPerMonth: inputData.requiredPerMonth ?? 0,
        kind: "funding-plan",
      });
    }

    return { ...inputData, decision: resumeData.decision, edits: resumeData.edits };
  },
});

const applyOrDiscard = createStep({
  id: "apply-or-discard",
  description: "Persists approved limits (and, for a savings Target, the derived Savings Goal), or reports a non-suspending outcome.",
  inputSchema: fundingSchema,
  outputSchema,
  execute: async ({ inputData, mastra }) => {
    const { resourceId, threadId, target, outcome, requiredPerMonth, declaredIncome, categoryLimits } = inputData;

    const coachAgent = mastra?.getAgent("coach");
    const memory = await coachAgent?.getMemory();

    // Non-suspending outcomes: no limits change hands.
    if (outcome === "infeasible") {
      return { status: "infeasible" as const, categoryLimits: categoryLimits ?? {}, requiredPerMonth, declaredIncome };
    }

    if (outcome === "fits") {
      // Savings already within Capacity — set the goal directly (no card),
      // consistent with setSavingsGoal being a direct write. Purchases persist
      // nothing (one-off).
      if (target.kind === "savings" && memory && requiredPerMonth !== undefined) {
        const raw = await memory.getWorkingMemory({ threadId, resourceId });
        const current = parseWorkingMemory(raw);
        await memory.updateWorkingMemory({
          threadId,
          resourceId,
          workingMemory: JSON.stringify({ ...current, savingsGoal: requiredPerMonth }),
        });
        return { status: "on-track" as const, categoryLimits: categoryLimits ?? {}, requiredPerMonth };
      }
      return { status: "fits-purchase" as const, categoryLimits: categoryLimits ?? {}, requiredPerMonth };
    }

    // outcome === "cuts": approve/reject came back via resumeData.
    const approved = inputData.decision === "approve";
    const status: "applied" | "discarded" = approved ? "applied" : "discarded";
    const mergedLimits = approved
      ? { ...(inputData.proposedLimits ?? {}), ...(inputData.edits ?? {}) }
      : (categoryLimits ?? {});

    // Defense in depth: the card disables Approve once the edited total exceeds
    // cap, but re-enforce ADR-0007's invariant here where limits are persisted.
    const cap = inputData.cap;
    const mergedSum = Object.values(mergedLimits).reduce((total, value) => total + (value ?? 0), 0);
    const nextLimits =
      approved && cap !== undefined && mergedSum > cap
        ? scaleLimitsToCap(mergedLimits, cap)
        : mergedLimits;

    if (memory) {
      const raw = await memory.getWorkingMemory({ threadId, resourceId });
      const current = parseWorkingMemory(raw);
      const next = {
        ...current,
        ...(approved ? { categoryLimits: nextLimits } : {}),
        // A savings Target's required/month becomes the recurring Savings Goal.
        ...(approved && target.kind === "savings" && requiredPerMonth !== undefined
          ? { savingsGoal: requiredPerMonth }
          : {}),
        pendingApproval: undefined,
      };
      await memory.updateWorkingMemory({ threadId, resourceId, workingMemory: JSON.stringify(next) });
    }

    return { status, categoryLimits: nextLimits, requiredPerMonth };
  },
});

export const goalFundingWorkflow = createWorkflow({
  id: "goal-funding-workflow",
  inputSchema: fundingSchema,
  outputSchema,
})
  .then(resolveTarget)
  .then(analyzeCapacity)
  .then(proposeReallocation)
  .then(approvalGate)
  .then(applyOrDiscard);

goalFundingWorkflow.commit();
