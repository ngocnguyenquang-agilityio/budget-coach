import { BlockedPhraseGuardrail } from "./processors/blocked-phrase-guardrail";

export const promptInjectionGuardrail = new BlockedPhraseGuardrail({
  blockedPhrases: [
    "ignore previous instructions",
    "ignore all previous instructions",
    "disregard your instructions",
    "reveal your system prompt",
    "you are now",
  ],
});

// Keeps the Coach a budgeting assistant, not an investment advisor.
export const financialAdviceGuardrail = new BlockedPhraseGuardrail({
  blockedPhrases: [
    "should i invest",
    "which stocks",
    "is crypto a good",
    "should i buy stock",
    "pick a stock",
    "financial advisor",
  ],
});
