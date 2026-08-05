# Design: Expand Mastra scorers to the trip planner and guardrail

## Purpose

The repo has one scorer today, `temperatureUnitScorer` (`src/mastra/scorers/temperature-unit-scorer.ts`),
wired into `weatherAgent`. `tripPlannerAgent` has no scorers, despite having
several checkable behavioral constraints in its instructions
(`src/mastra/agents/trip-planner-agent.ts`): an exact output format per day,
a mandated tool-call order, and an exact requested day count. Separately,
`promptInjectionGuardrail` (`src/mastra/guardrails.ts`) has no regression
coverage — nothing catches a new phrasing that slips past its hardcoded
`blockedPhrases` list.

This adds two live, per-turn scorers on `tripPlannerAgent` (format compliance
and tool-usage compliance), plus one standalone offline eval script that
regression-tests the guardrail's phrase coverage. `ResponseCache` is
explicitly out of scope: it caches at the LLM-call boundary and never
surfaces hit/miss state into what a scorer or eval sees, so there's no
observable signal to score.

## Why guardrail/cache don't fit the live-scorer pattern

`BlockedPhraseGuardrail.abort()` (called from `processInput`) stops the
request before the model is ever called — a blocked turn produces no agent
output for a scorer to attach to. Scorers evaluate completed input/output
pairs; there's nothing to evaluate on a turn that never reached generation.
This is why guardrail coverage is a standalone eval script that drives the
agent directly and inspects whether calls throw/abort, not a scorer
registered on `tripPlannerAgent.scorers`.

`ResponseCache` hooks `processLLMRequest`/`processLLMResponse` internally and
exposes no hit/miss metadata to agent-level output — there is no reliable
field a scorer or eval could read to confirm a cache hit occurred. Cache
correctness is left uncovered by this design.

## Scorer 1: `trip-itinerary-format-scorer.ts`

New file `src/mastra/scorers/trip-itinerary-format-scorer.ts`. Function-only
`createScorer({ type: 'agent' })` — no judge — following the style of
`temperature-unit-scorer.ts` (reuse its `getResponseText` extraction pattern
for the assistant's response text).

**preprocess**

- Extract the requested day count from the latest user message via
  `/(\d+)\s*[- ]?day/i` (searching `input.inputMessages` concatenated with
  `input.rememberedMessages` for the current turn's user text); `null` if no
  count is stated.
- Extract the assistant's full response text.

**analyze**

- Regex-match all `🧳 Day N` headers, in order of appearance, each expected
  to be immediately followed by:
  - a separator line consisting only of `═` characters (length not checked —
    the instructions don't mandate an exact count, just presence of the
    separator),
  - a `Morning:` line,
  - an `Afternoon:` line,
  - an `Evening:` line.
- Count of well-formed day blocks found, and count of headers found overall
  (a header with a malformed body still counts as "found" but not
  "well-formed").
- Detect the closing `⚠️ NOTE` section: must appear exactly once, and only
  after the last day block.

Return shape:

```typescript
type AnalyzeResult = {
  requestedDayCount: number | null;
  headersFound: number;
  wellFormedDayBlocks: number;
  closingNoteCount: number;
  closingNoteAfterLastDay: boolean;
};
```

**generateScore**

- `1` if: `requestedDayCount` is `null` OR `headersFound === requestedDayCount`,
  AND `wellFormedDayBlocks === headersFound` (every header has a complete
  body), AND `closingNoteCount === 1` AND `closingNoteAfterLastDay`.
- `0` if `requestedDayCount` is not `null` and `headersFound !== requestedDayCount`
  (wrong number of days is the clearest, most user-visible failure).
- `0.5` if the day count matches (or wasn't statable) but the day blocks
  aren't all well-formed, or the closing note is missing/duplicated/misplaced.

**generateReason**

- Plain string naming the specific failure: day-count mismatch (stating
  requested vs. found), malformed day block count, or closing-note issue
  (missing / duplicated / misplaced).

## Scorer 2: `trip-tool-usage-scorer.ts`

New file `src/mastra/scorers/trip-tool-usage-scorer.ts`. Function-only
`createScorer({ type: 'agent' })`, checking the tool-call order mandated by
`tripPlannerAgent`'s instructions ("Always call askWeatherAgentTool first...
do not write any itinerary content before you have the tool's result", then
"call searchDestinationGuideTool").

Per the existing comment convention in `temperature-unit-scorer.ts`: tool
names read from `part.toolInvocation.toolName` reflect the *registration
key* in the agent's `tools` map (`askWeatherAgentTool`,
`searchDestinationGuideTool`), not the tool's own `id` field
(`ask-weather-agent`, `search-destination-guide`).

**preprocess**

- Walk `run.output` message parts in order, recording the index (position in
  the flattened part sequence) of:
  - the first `askWeatherAgentTool` tool-invocation result,
  - the first `searchDestinationGuideTool` tool-invocation result,
  - the first `text` part.

**analyze**

```typescript
type AnalyzeResult = {
  weatherCalled: boolean;
  weatherBeforeText: boolean;
  guideCalled: boolean;
  guideInCorrectOrder: boolean;
};
```

`guideInCorrectOrder` must check the guide tool's index against *both*
`weatherToolIndex` and `firstTextIndex` — comparing only against the weather
tool's position can't distinguish "guide called between weather and text"
(fine) from "guide called after text already started" (a real ordering
violation), since both cases put the guide's index after the weather tool's.

**generateScore**

- `0` if `!weatherCalled || !weatherBeforeText` (the hard requirement: weather
  must be called, and before any itinerary text).
- `0.5` if weather compliance holds but `guideCalled && !guideInCorrectOrder`
  (guide called out of order — a real violation of the instructed sequence).
- `1` if weather compliance holds and either the guide wasn't called at all
  (acceptable — the tool legitimately returns empty for uncovered cities and
  the agent is told not to dwell on that) or was called after weather and
  before any itinerary text.

**generateReason**

- Names which tool was missing or out of order.

## Guardrail eval script

New file `scripts/guardrail-eval.ts`, matching the existing
`scripts/seed-destination-guides.ts` convention (standalone script, relative
imports into `../src/mastra/...`, wired to a `pnpm` script in
`package.json`). Not registered on any agent or on the `Mastra` instance —
run manually (no test runner is configured in this repo per
`.claude/CLAUDE.md`).

- A fixed list of adversarial prompts: paraphrases of each entry in
  `promptInjectionGuardrail`'s `blockedPhrases` (from `src/mastra/guardrails.ts`),
  plus a few novel phrasings not literally present in that list (e.g. a
  differently-worded jailbreak attempt), to surface coverage gaps rather than
  just re-confirming exact-string matches.
- For each prompt, calls `tripPlannerAgent.generate(prompt)` and checks the
  result's `tripwire` field: per `generate()`'s documented behavior, a
  blocked request resolves normally with `result.tripwire` set (`{ reason,
  processorId, ... }`) rather than throwing — the guardrail held if
  `result.tripwire` is truthy, bypassed if it's absent.
- The script iterates the prompt list directly (no `createScorer`/`.run()`
  needed — this is a plain pass/fail check, not a multi-step analysis
  pipeline), prints a pass/fail table, and exits with code `1` if any prompt
  bypassed the guardrail.
- New `package.json` script: `"eval:guardrail": "tsx scripts/guardrail-eval.ts"`,
  matching the `"seed:guides": "tsx scripts/seed-destination-guides.ts"`
  pattern. Runnable via `pnpm eval:guardrail` (requires local Ollama running,
  same as the rest of the app).

## Wiring

- `src/mastra/agents/trip-planner-agent.ts`: import both new scorers, add:

  ```typescript
  scorers: {
    tripItineraryFormat: {
      scorer: tripItineraryFormatScorer,
      sampling: { type: 'ratio', rate: 1 },
    },
    tripToolUsage: {
      scorer: tripToolUsageScorer,
      sampling: { type: 'ratio', rate: 1 },
    },
  },
  ```

- `src/mastra/index.ts`: add both to the top-level `scorers` map alongside
  `temperatureUnitCompliance`, for trace scoring.
- The guardrail eval script is not registered anywhere.

## Out of scope

- Cache-effectiveness scoring (no observable signal, see above).
- Live/registered guardrail scoring (structurally impossible per above).
- A judge/LLM-based "destination-guide grounding quality" scorer — deferred;
  the two scorers here are both deterministic function-only, matching the
  existing `temperatureUnitScorer` style and avoiding a local-Ollama judge
  dependency for this pass.
- Any change to `weatherAgent`'s existing scorer.
- Introducing a test runner for the guardrail eval.

## Testing

No test runner in this repo. Manual verification:

1. `pnpm dev` (local Ollama running), chat with the trip planner for a few
   different city/day-count combinations (including a request with no
   explicit day count, and one with a mismatched day count if forceable) and
   confirm `tripItineraryFormat`/`tripToolUsage` scores look correct via
   Mastra Studio (`http://localhost:4111`) or `mastra api score` against the
   stored traces.
2. Run `pnpm eval:guardrail` and confirm all known + novel adversarial
   prompts report as blocked.
3. `pnpm lint` for type/lint correctness.
