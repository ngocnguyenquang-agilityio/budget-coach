# LLM judge replaces keyword matching in coachScopeScorer

`docs/spec.md` originally committed all scorers to being deterministic, no LLM judge, so quality signal wouldn't itself depend on a flaky model call. `coachScopeScorer` followed that as a `text.includes(keyword)` scan against a fixed `REGULATED_ADVICE_KEYWORDS` list — the same brittleness `financialAdviceGuardrail` already had to work around on the input side with a co-occurrence heuristic, since a paraphrase like "an index fund could be worth a look" hits none of the fixed phrases. We replaced the scorer's `.analyze()` step with an LLM judge (same `cerebras/gpt-oss-120b` model) that grades scope drift on a `none/mild/moderate/severe` rubric instead, giving graded signal a keyword list can't express. `categorizerAccuracyScorer` and `adjustmentReasonablenessScorer` are unchanged and deliberately stay deterministic — they check against an objective ground truth (seed category, trailing spend), where a judge would add cost and non-determinism without adding correctness. The guardrail processors (`financialAdviceGuardrail`, `regulatedAdviceOutputGuardrail`) also stay keyword-based; they're synchronous hard blocks inside `processInput` and aren't a fit for an async judge call.

## Considered Options

- **Keep keyword matching, expand the phrase list** — rejected: an ever-growing list of exact phrases chases paraphrases one at a time and never closes the gap.
- **LLM judge with a raw 0–1 float output** — rejected: models aren't reliably calibrated at producing a continuous score on demand; a categorical severity judgment mapped to fixed numbers in code is more consistent and auditable.

## Consequences

- `coachScopeScorer` is now the only scorer in the project that isn't fully deterministic; its tests (`coach-scope.test.ts`) mock the judge model (`ai/test`'s `MockLanguageModelV3`, added as a devDependency) instead of asserting against real output.
- Every scored Coach turn now costs one extra Cerebras call (judge), subject to the same 5 req/min free-tier cap as the agents themselves — mitigated with the same `StreamErrorRetryProcessor` backoff config already used elsewhere.
- `coachScopeScorer` returns a graded score (1, 0.66, 0.33, 0) rather than strict 1/0, unlike the project's other two scorers — intentional, since scope drift is a matter of degree and the other two check against an objective ground truth.
