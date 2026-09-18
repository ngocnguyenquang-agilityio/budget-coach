import { BlockedPhraseGuardrail } from "../processors/blocked-phrase-guardrail";
import { PromptInjectionGuardrail } from "../processors/prompt-injection-guardrail";
import { FinancialAdviceGuardrail } from "../processors/financial-advice-guardrail";
import { RegulatedAdviceOutputGuardrail } from "../processors/regulated-advice-output-guardrail";
import { WorkingMemoryLeakGuardrail } from "../processors/working-memory-leak-guardrail";
import {
  PROMPT_INJECTION_PHRASES,
  PROMPT_INJECTION_INTENT_KEYWORDS,
  PROMPT_INJECTION_TARGET_KEYWORDS,
  FINANCIAL_INSTRUMENT_KEYWORDS,
  DECISION_SEEKING_KEYWORDS,
  REGULATED_ADVICE_KEYWORDS,
  WORKING_MEMORY_LEAK_MARKERS,
} from "@/constants/guardrail-phrases";

export const promptInjectionGuardrail = new BlockedPhraseGuardrail({
  blockedPhrases: PROMPT_INJECTION_PHRASES,
  userMessage: "I can't process that request.",
});

// Paraphrase-resistant companion to promptInjectionGuardrail: blocks on the
// co-occurrence of an intent word and a target word (see guardrail-phrases.ts),
// catching injections the fixed-phrase list above misses.
export const promptInjectionHeuristicGuardrail = new PromptInjectionGuardrail({
  intentKeywords: PROMPT_INJECTION_INTENT_KEYWORDS,
  targetKeywords: PROMPT_INJECTION_TARGET_KEYWORDS,
  userMessage: "I can't process that request.",
});

// Keeps the Coach a budgeting assistant, not an investment advisor.
export const financialAdviceGuardrail = new FinancialAdviceGuardrail({
  instrumentKeywords: FINANCIAL_INSTRUMENT_KEYWORDS,
  decisionKeywords: DECISION_SEEKING_KEYWORDS,
  userMessage: "I can only help with budgeting, not investment advice.",
});

// Output-side backstop for financialAdviceGuardrail — catches the Coach's
// own response drifting into regulated-advice territory even when the
// user's question didn't trip an input guardrail.
export const regulatedAdviceOutputGuardrail = new RegulatedAdviceOutputGuardrail({
  blockedKeywords: REGULATED_ADVICE_KEYWORDS,
  redirectMessage: "I can't help with investment advice — I can help you budget for it, though.",
});

// Output-side backstop for the Coach's read-only working memory (coach.ts) —
// redacts a raw working-memory JSON dump if the model pastes one into its
// reply instead of treating it as background context only.
export const workingMemoryLeakGuardrail = new WorkingMemoryLeakGuardrail(WORKING_MEMORY_LEAK_MARKERS);
