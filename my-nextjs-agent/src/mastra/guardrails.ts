import { BlockedPhraseGuardrail } from './processors/blocked-phrase-guardrail';

export const promptInjectionGuardrail = new BlockedPhraseGuardrail({
  blockedPhrases: [
    'ignore previous instructions',
    'ignore all previous instructions',
    'disregard your instructions',
    'reveal your system prompt',
    'you are now',
  ],
});
