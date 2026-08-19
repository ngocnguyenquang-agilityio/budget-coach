import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RequestContext } from "@mastra/core/request-context";
import { computeAnalysis } from "@/domain/analysis";
import { proposeCategoryLimits } from "@/domain/propose-limits";
import type { Category } from "@/domain/categories";

// mastra (and the storage/dbClient singletons it pulls in) read
// TURSO_DATABASE_URL at import time, same as src/db/transactions.test.ts —
// set it to a temp file before anything under test is imported so this
// suite never touches the dev budget-coach.db.
const previousDbUrl = process.env.TURSO_DATABASE_URL;
const tmpDir = mkdtempSync(path.join(tmpdir(), "budget-coach-integration-test-"));
process.env.TURSO_DATABASE_URL = `file:${path.join(tmpDir, "test.db")}`;

const { mastra } = await import("./index");
const { MonthlyReviewSuspendSchema } = await import("./workflows/monthly-review-workflow");
const { seedIfEmpty, listTransactions, addTransaction } = await import("@/db/transactions");
const { parseWorkingMemory } = await import("./parse-working-memory");
const { dbClient } = await import("@/db/client");

afterAll(() => {
  dbClient.close();
  if (previousDbUrl === undefined) {
    delete process.env.TURSO_DATABASE_URL;
  } else {
    process.env.TURSO_DATABASE_URL = previousDbUrl;
  }
  // Windows can hold a brief lock on the WAL file after close(); cleanup is
  // best-effort so a lingering lock doesn't fail the suite.
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

const mockUsage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

// A fake LanguageModelV3 that calls one tool by name, then replies with
// plain text — stands in for Cerebras so these tests don't need a live
// model server. Hand-rolled (rather than `ai/test`'s MockLanguageModelV3)
// because `ai` is only a transitive dependency here, not hoisted by pnpm.
//
// Cast `as any` at the call site below: TS's structural check of an object
// literal against Mastra's bundled (internal, non-exported) LanguageModelV3
// union produces a misleading "doStream result missing" error rather than a
// real mismatch — the shape here is correct and is exercised at runtime by
// every test that uses it.
const toolCallModel = (toolName: string, input: Record<string, unknown>) => {
  const responses = [
    {
      content: [{ type: "tool-call", toolCallId: "call-1", toolName, input: JSON.stringify(input) }],
      finishReason: { unified: "tool-calls", raw: "tool_calls" },
      usage: mockUsage,
    },
    {
      content: [{ type: "text", text: "Done." }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: mockUsage,
    },
  ];
  let calls = 0;

  return {
    specificationVersion: "v3" as const,
    provider: "mock",
    modelId: "mock-model",
    supportedUrls: {},
    doGenerate: async () => responses[Math.min(calls++, responses.length - 1)],
    doStream: async () => {
      throw new Error("doStream is not implemented by this mock model");
    },
  };
};

const startSuspendedReview = async (resourceId: string, threadId: string) => {
  await seedIfEmpty(resourceId);
  const workflow = mastra.getWorkflow("monthlyReviewWorkflow");
  const run = await workflow.createRun();
  const result = await run.start({ inputData: { resourceId, threadId } });
  return { run, result };
};

// `result.steps["approval-gate"].suspendPayload` types as `{}` off the
// generic workflow-run result rather than MonthlyReviewSuspendSchema's
// inferred shape, so parse it through the schema itself to both get a
// properly-typed value and assert the shape ticket 08 asks for.
const parseSuspendPayload = (result: Awaited<ReturnType<typeof startSuspendedReview>>["result"]) => {
  if (result.status !== "suspended") {
    throw new Error(`Expected the workflow run to be suspended, got status: ${result.status}`);
  }
  const parsed = MonthlyReviewSuspendSchema.safeParse(result.steps["approval-gate"].suspendPayload);
  if (!parsed.success) {
    throw new Error(`approval-gate suspendPayload did not match MonthlyReviewSuspendSchema: ${parsed.error.message}`);
  }
  return parsed.data;
};

const getWorkingMemoryState = async (threadId: string, resourceId: string) => {
  const coachAgent = mastra.getAgent("coach");
  const memory = await coachAgent.getMemory();
  const raw = memory ? await memory.getWorkingMemory({ threadId, resourceId }) : null;
  return parseWorkingMemory(raw);
};

describe("coachAgent tool resolution (bypassing the CopilotKit route)", () => {
  it("dispatches a model tool call by the tools map key ('setSavingsGoal'), not the tool's own id ('set-savings-goal')", async () => {
    const coachAgent = mastra.getAgent("coach");
    const resourceId = "integration-tool-resolution";
    const threadId = "thread-tool-resolution";

    const result = await coachAgent.generate("Set my monthly savings goal to $500.", {
      model: toolCallModel("setSavingsGoal", { savingsGoal: 500 }) as any,
      memory: { thread: threadId, resource: resourceId },
    });

    const toolResult = result.toolResults?.find((r) => r.payload.toolName === "setSavingsGoal");
    expect(toolResult?.payload.result).toEqual({ savingsGoal: 500 });

    const state = await getWorkingMemoryState(threadId, resourceId);
    expect(state.savingsGoal).toBe(500);
  });
});

describe("monthlyReviewWorkflow", () => {
  it("suspends at approval-gate with proposed limits ~110% of spend on first run", async () => {
    const resourceId = "wf-suspend-shape";
    const { result } = await startSuspendedReview(resourceId, "thread-suspend-shape");

    expect(result.status).toBe("suspended");
    const suspendPayload = parseSuspendPayload(result);

    const transactions = await listTransactions(resourceId);
    const period = new Date().toISOString().slice(0, 7);
    const expectedAnalysis = computeAnalysis(transactions, {}, period);
    const expectedProposed = proposeCategoryLimits(expectedAnalysis);

    for (const [category, limit] of Object.entries(expectedProposed) as [Category, number][]) {
      expect(suspendPayload.proposedLimits[category]).toBeCloseTo(limit, 2);
    }
  });

  it("regression: genuinely pauses at approval-gate (return suspend(...), not await suspend()) until resumed", async () => {
    const { result } = await startSuspendedReview("wf-pause-regression", "thread-pause-regression");

    expect(result.status).toBe("suspended");
    // If approval-gate had used `await suspend()` instead of `return
    // suspend()`, execution would fall through to apply-or-discard within
    // the same run.start() call instead of actually waiting for resume.
    expect(result.steps["apply-or-discard"]).toBeUndefined();
  });

  it("persists categoryLimits into Coach working memory when resumed with an approve decision", async () => {
    const resourceId = "wf-approve";
    const threadId = "thread-approve";
    const { run } = await startSuspendedReview(resourceId, threadId);

    const resumeResult = await run.resume({ resumeData: { decision: "approve" as const } });
    expect(resumeResult.status).toBe("success");

    const transactions = await listTransactions(resourceId);
    const period = new Date().toISOString().slice(0, 7);
    const expectedProposed = proposeCategoryLimits(computeAnalysis(transactions, {}, period));

    const state = await getWorkingMemoryState(threadId, resourceId);
    expect(state.categoryLimits).toEqual(expectedProposed);
  });

  it("does not persist a categoryLimits change when resumed with a reject decision", async () => {
    const resourceId = "wf-reject";
    const threadId = "thread-reject";

    // Establish a known categoryLimits baseline via an approved review
    // first, then change trailing spend before a second review so its
    // proposedLimits genuinely differ from the baseline. That way, a reject
    // that wrongly persists `proposedLimits` produces a *different* value
    // than the baseline rather than a coincidentally-identical one — an
    // assertion against `undefined` alone (nothing was ever set) wouldn't
    // catch that bug.
    const first = await startSuspendedReview(resourceId, threadId);
    await first.run.resume({ resumeData: { decision: "approve" as const } });
    const baseline = await getWorkingMemoryState(threadId, resourceId);

    await addTransaction({
      resourceId,
      date: new Date().toISOString().slice(0, 10),
      merchant: "Extra Dining Splurge",
      amount: 500,
      type: "expense",
      category: "Dining",
      seedCategory: null,
    });

    const second = await startSuspendedReview(resourceId, threadId);
    const secondSuspendPayload = parseSuspendPayload(second.result);
    expect(secondSuspendPayload.proposedLimits).not.toEqual(baseline.categoryLimits);

    const resumeResult = await second.run.resume({ resumeData: { decision: "reject" as const } });
    expect(resumeResult.status).toBe("success");

    const afterReject = await getWorkingMemoryState(threadId, resourceId);
    expect(afterReject.categoryLimits).toEqual(baseline.categoryLimits);
  });
});

describe("Coach dynamic instructions (ag-ui requestContext regression)", () => {
  it("includes ag-ui frontend context in the resolved instructions when present", async () => {
    const coachAgent = mastra.getAgent("coach");
    const frontendContext = { highlightedCategory: "Dining" };

    const withContext = await coachAgent.getInstructions({
      requestContext: new RequestContext([["ag-ui", frontendContext]]),
    });
    expect(String(withContext)).toContain(JSON.stringify(frontendContext));

    const withoutContext = await coachAgent.getInstructions({ requestContext: new RequestContext() });
    expect(String(withoutContext)).not.toContain("Frontend context:");
  });
});
