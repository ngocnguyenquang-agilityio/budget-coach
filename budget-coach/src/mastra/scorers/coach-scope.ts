import { createScorer } from "@mastra/core/evals";
import { StreamErrorRetryProcessor } from "@mastra/core/processors";
import type { MastraModelConfig } from "@mastra/core/llm";
import { z } from "zod";
import { getAssistantText } from "./message-text";
import { model } from "@/mastra/model";
import {
  COACH_SCOPE_JUDGE_INSTRUCTIONS,
  COACH_SCOPE_SEVERITY_SCORES,
  type CoachScopeSeverity,
} from "@/constants/coach-scope-rubric";

// LLM judge, not keyword matching: paraphrases of investment advice (e.g. "an
// index fund could be worth a look") don't hit any fixed phrase list. Pairs
// with financialAdviceGuardrail/regulatedAdviceOutputGuardrail (src/mastra/
// processors/*.ts), which stay keyword-based since they're synchronous hard
// blocks inside processInput and aren't a fit for an async judge call.
//
// Takes an optional judge model override so tests can inject a mock model
// instead of calling Cerebras (see coach-scope.test.ts).
export const createCoachScopeScorer = (judgeModel: MastraModelConfig = model) =>
  createScorer({
    id: "coach-scope",
    description: "LLM judge that grades how far a Coach response drifts into investment or regulated-advice territory.",
    type: "agent",
    judge: {
      model: judgeModel,
      instructions: COACH_SCOPE_JUDGE_INSTRUCTIONS,
      // Cerebras's free tier caps at 5 requests/minute; retry transient 429s
      // with backoff, same as the Coach/Categorizer agents themselves.
      errorProcessors: [
        new StreamErrorRetryProcessor({
          retryUnknownErrors: true,
          maxRetries: 2,
          delayMs: ({ retryCount }) => Math.min(4000 * 2 ** retryCount, 20000),
        }),
      ],
    },
  })
    .analyze({
      description: "Grade the severity of scope drift in the Coach's response",
      outputSchema: z.object({
        severity: z.enum(["none", "mild", "moderate", "severe"]),
        reasoning: z.string(),
      }),
      createPrompt: ({ run }) => `Coach response:\n${getAssistantText(run.output)}`,
    })
    .generateScore(
      ({ results }) => COACH_SCOPE_SEVERITY_SCORES[results.analyzeStepResult.severity as CoachScopeSeverity]
    )
    .generateReason(({ results, score }) => `Score: ${score}. ${results.analyzeStepResult.reasoning}`);

export const coachScopeScorer = createCoachScopeScorer();
