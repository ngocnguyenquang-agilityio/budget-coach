import { BlockedPhraseGuardrail } from "./processors/blocked-phrase-guardrail";
import { PROMPT_INJECTION_PHRASES, FINANCIAL_ADVICE_BLOCKED_PHRASES } from "@/constants/guardrail-phrases";

export const promptInjectionGuardrail = new BlockedPhraseGuardrail({
  blockedPhrases: PROMPT_INJECTION_PHRASES,
});

// Keeps the Coach a budgeting assistant, not an investment advisor.
export const financialAdviceGuardrail = new BlockedPhraseGuardrail({
  blockedPhrases: FINANCIAL_ADVICE_BLOCKED_PHRASES,
});
