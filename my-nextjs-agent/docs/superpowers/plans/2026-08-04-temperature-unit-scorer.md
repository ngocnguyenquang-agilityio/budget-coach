# Temperature-Unit Compliance Scorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Mastra `Scorers` example — a deterministic `temperatureUnitScorer` that checks every `weatherAgent` response's stated temperature unit against the user's saved working-memory preference (and verifies the °F conversion math when applicable), wired as a live scorer on the agent and registered on the `Mastra` instance for trace scoring.

**Architecture:** `createScorer({ type: 'agent' })` from `@mastra/core/evals` builds a four-step, function-only pipeline (no LLM judge): `preprocess` pulls the raw Celsius reading out of the `get-weather` tool-invocation part in `run.output` and the saved unit preference out of the working-memory text embedded in `run.input.systemMessages`; `analyze` extracts the unit/value the response text actually states and compares both to what `preprocess` found; `generateScore` turns that comparison into 0 / 0.5 / 1; `generateReason` explains it in plain English. The scorer is attached to `weatherAgent` via its `scorers` option (live evaluation, sampled at 100%) and also registered on the `Mastra` instance's own `scorers` option so it shows up for trace scoring in Studio's Observability tab.

**Tech Stack:** Mastra (`@mastra/core/evals`, `@mastra/core/memory`), TypeScript, Zod-free (no LLM judge, so no `outputSchema`/prompt objects needed). No test runner is configured in this project — verification uses a standalone `tsx` script that calls `scorer.run()` against synthetic fixtures, plus `npx tsc --noEmit`, `pnpm lint`, and manual exercise via `pnpm dev`.

## Global Constraints

- Package manager is pnpm — use `pnpm` for all script invocation, not `npm`/`yarn`.
- No test runner exists in this project — do not add one; verify via a throwaway `tsx` script plus typecheck/lint/manual run.
- A local Ollama server (`http://localhost:11434`, model `llama3.1`) must be running for manual chat verification, but is **not** required for the scorer itself — it is fully function-based with no judge model.
- `weatherTool` (`src/mastra/tools/weather-tool.ts`) always returns `temperature`/`feelsLike` in Celsius; the agent does the F conversion itself in its response text (`src/mastra/agents/weather-agent.ts:24-26`).
- The working-memory preference is stored as the literal text `# Preferences\n- Temperature Unit: celsius` or `...fahrenheit` (`src/mastra/tools/set-temperature-unit-tool.ts:33`) and defaults to unset (treat as `celsius`) until the user asks for Fahrenheit.
- The scorer must be a pure function pipeline (no `judge` config) — this is a deterministic example, not an LLM-judge example.

---

### Task 1: `temperatureUnitScorer` and its verification script

**Files:**
- Create: `src/mastra/scorers/temperature-unit-scorer.ts`
- Create: `scripts/verify-temperature-unit-scorer.ts`

**Interfaces:**
- Consumes: `createScorer` from `@mastra/core/evals`; `ScorerRunInputForAgent`, `ScorerRunOutputForAgent` types from `@mastra/core/evals`; `MastraDBMessage` type from `@mastra/core/memory`.
- Produces: `temperatureUnitScorer` (a `MastraScorer` instance, `id: 'temperature-unit-compliance'`) exported from `src/mastra/scorers/temperature-unit-scorer.ts`. Task 2 imports it as `import { temperatureUnitScorer } from '../scorers/temperature-unit-scorer'`. Task 3 imports it as `import { temperatureUnitScorer } from './scorers/temperature-unit-scorer'`.

- [ ] **Step 1: Create the scorer file**

Create `src/mastra/scorers/temperature-unit-scorer.ts`:

```ts
import { createScorer } from '@mastra/core/evals';
import type { ScorerRunInputForAgent, ScorerRunOutputForAgent } from '@mastra/core/evals';
import type { MastraDBMessage } from '@mastra/core/memory';

type PreferredUnit = 'celsius' | 'fahrenheit';

type PreprocessResult = {
  preferredUnit: PreferredUnit;
  toolCelsius: number | null;
  responseText: string;
};

type AnalyzeResult = {
  preferredUnit: PreferredUnit;
  reportedUnit: PreferredUnit | null;
  reportedValue: number | null;
  expectedValue: number | null;
  unitMatches: boolean | null;
  valueWithinTolerance: boolean | null;
};

function getResponseText(messages: ScorerRunOutputForAgent): string {
  let text = '';

  for (const message of messages) {
    if (message.role !== 'assistant') continue;

    for (const part of message.content.parts ?? []) {
      if (part.type === 'text' && typeof part.text === 'string') {
        text += part.text;
      }
    }
  }

  return text;
}

function getToolCelsius(messages: ScorerRunOutputForAgent): number | null {
  for (const message of messages) {
    for (const part of message.content.parts ?? []) {
      if (part.type !== 'tool-invocation') continue;

      const invocation = part.toolInvocation;
      if (invocation.toolName !== 'get-weather') continue;
      if (invocation.state !== 'result') continue;

      const result = invocation.result as { temperature?: unknown } | undefined;
      if (typeof result?.temperature === 'number') {
        return result.temperature;
      }
    }
  }

  return null;
}

function getPreferredUnit(input: ScorerRunInputForAgent): PreferredUnit {
  const texts: string[] = [
    ...input.systemMessages.map((message) =>
      typeof message.content === 'string' ? message.content : '',
    ),
    ...Object.values(input.taggedSystemMessages)
      .flat()
      .map((message) => (typeof message.content === 'string' ? message.content : '')),
  ];

  for (const text of texts) {
    const match = text.match(/Temperature Unit:\s*(celsius|fahrenheit)/i);
    if (match) {
      return match[1].toLowerCase() as PreferredUnit;
    }
  }

  return 'celsius';
}

function extractStatedTemperature(
  responseText: string,
): { unit: PreferredUnit; value: number } | null {
  const match = responseText.match(/(-?\d+(?:\.\d+)?)\s*°?\s*(celsius|fahrenheit|c|f)\b/i);
  if (!match) return null;

  const value = Number.parseFloat(match[1]);
  const rawUnit = match[2].toLowerCase();
  const unit: PreferredUnit = rawUnit.startsWith('f') ? 'fahrenheit' : 'celsius';

  return { unit, value };
}

export const temperatureUnitScorer = createScorer({
  id: 'temperature-unit-compliance',
  description:
    "Checks that a weather-agent response states temperature in the user's saved unit preference, and that °F values are converted correctly from the tool's raw Celsius reading.",
  type: 'agent',
})
  .preprocess(({ run }): PreprocessResult => {
    const output = run.output as ScorerRunOutputForAgent;
    const input = run.input as ScorerRunInputForAgent;

    return {
      preferredUnit: getPreferredUnit(input),
      toolCelsius: getToolCelsius(output),
      responseText: getResponseText(output),
    };
  })
  .analyze(({ results }): AnalyzeResult => {
    const { preferredUnit, toolCelsius, responseText } = results.preprocessStepResult;
    const stated = extractStatedTemperature(responseText);

    if (!stated) {
      return {
        preferredUnit,
        reportedUnit: null,
        reportedValue: null,
        expectedValue: null,
        unitMatches: null,
        valueWithinTolerance: null,
      };
    }

    const unitMatches = stated.unit === preferredUnit;

    let expectedValue: number | null = null;
    let valueWithinTolerance: boolean | null = null;

    if (toolCelsius !== null) {
      expectedValue =
        preferredUnit === 'fahrenheit' ? (toolCelsius * 9) / 5 + 32 : toolCelsius;
      valueWithinTolerance = Math.abs(stated.value - expectedValue) <= 1;
    }

    return {
      preferredUnit,
      reportedUnit: stated.unit,
      reportedValue: stated.value,
      expectedValue,
      unitMatches,
      valueWithinTolerance,
    };
  })
  .generateScore(({ results }) => {
    const { reportedUnit, unitMatches, valueWithinTolerance, expectedValue } =
      results.analyzeStepResult;

    // No stated temperature this turn (e.g. agent asked for a location) — nothing to violate.
    if (reportedUnit === null) return 1;

    if (!unitMatches) return 0;

    // Unit matched but there's no tool reading to check the number against.
    if (expectedValue === null) return 0.5;

    return valueWithinTolerance ? 1 : 0;
  })
  .generateReason(({ results, score }) => {
    const { preferredUnit, reportedUnit, reportedValue, expectedValue, unitMatches } =
      results.analyzeStepResult;

    if (reportedUnit === null) {
      return `Score: ${score}. Response stated no temperature, so there was nothing to check.`;
    }

    if (!unitMatches) {
      return `Score: ${score}. Response stated ${reportedUnit}, but the saved preference is ${preferredUnit}.`;
    }

    if (expectedValue === null) {
      return `Score: ${score}. Response correctly used ${preferredUnit}, but no tool reading was available to verify the value ${reportedValue}.`;
    }

    return `Score: ${score}. Response stated ${reportedValue}°${preferredUnit === 'fahrenheit' ? 'F' : 'C'}, expected approximately ${expectedValue.toFixed(1)}.`;
  });
```

- [ ] **Step 2: Create the verification script**

Create `scripts/verify-temperature-unit-scorer.ts`:

```ts
import { temperatureUnitScorer } from '../src/mastra/scorers/temperature-unit-scorer';
import type { MastraDBMessage } from '@mastra/core/memory';

function assistantMessage(parts: MastraDBMessage['content']['parts']): MastraDBMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    createdAt: new Date(),
    content: { format: 2, parts },
  };
}

function toolResultPart(temperature: number): MastraDBMessage['content']['parts'][number] {
  return {
    type: 'tool-invocation',
    toolInvocation: {
      toolCallId: 'call-1',
      toolName: 'get-weather',
      state: 'result',
      args: { location: 'Berlin' },
      result: { temperature, feelsLike: temperature, humidity: 50, windSpeed: 5, windGust: 8, conditions: 'Clear sky', location: 'Berlin' },
    },
  } as unknown as MastraDBMessage['content']['parts'][number];
}

function textPart(text: string): MastraDBMessage['content']['parts'][number] {
  return { type: 'text', text } as unknown as MastraDBMessage['content']['parts'][number];
}

function systemMessages(text: string) {
  return { systemMessages: [{ role: 'system' as const, content: text }], taggedSystemMessages: {} };
}

async function expectScore(name: string, promise: Promise<{ score: number }>, expected: number) {
  const result = await promise;
  if (result.score !== expected) {
    throw new Error(`${name}: expected score ${expected}, got ${result.score}`);
  }
  console.log(`PASS ${name} (score ${result.score})`);
}

async function main() {
  // Celsius preference, correct Celsius response -> 1
  await expectScore(
    'celsius-correct',
    temperatureUnitScorer.run({
      input: { inputMessages: [], rememberedMessages: [], ...systemMessages('# Preferences\n- Temperature Unit: celsius') },
      output: [assistantMessage([toolResultPart(20), textPart('It is 20°C and clear in Berlin.')])],
    }),
    1,
  );

  // Fahrenheit preference, correctly converted -> 1 (20C -> 68F)
  await expectScore(
    'fahrenheit-correct',
    temperatureUnitScorer.run({
      input: { inputMessages: [], rememberedMessages: [], ...systemMessages('# Preferences\n- Temperature Unit: fahrenheit') },
      output: [assistantMessage([toolResultPart(20), textPart('It is 68°F and clear in Berlin.')])],
    }),
    1,
  );

  // Fahrenheit preference, but response states Celsius -> 0
  await expectScore(
    'fahrenheit-preference-celsius-response',
    temperatureUnitScorer.run({
      input: { inputMessages: [], rememberedMessages: [], ...systemMessages('# Preferences\n- Temperature Unit: fahrenheit') },
      output: [assistantMessage([toolResultPart(20), textPart('It is 20°C and clear in Berlin.')])],
    }),
    0,
  );

  // Fahrenheit preference, correct unit but wrong math -> 0
  await expectScore(
    'fahrenheit-bad-math',
    temperatureUnitScorer.run({
      input: { inputMessages: [], rememberedMessages: [], ...systemMessages('# Preferences\n- Temperature Unit: fahrenheit') },
      output: [assistantMessage([toolResultPart(20), textPart('It is 50°F and clear in Berlin.')])],
    }),
    0,
  );

  // No preference set (defaults to celsius), no temperature stated (agent asked for location) -> 1
  await expectScore(
    'no-temperature-stated',
    temperatureUnitScorer.run({
      input: { inputMessages: [], rememberedMessages: [], systemMessages: [], taggedSystemMessages: {} },
      output: [assistantMessage([textPart('Which city would you like the weather for?')])],
    }),
    1,
  );

  console.log('All temperature-unit-scorer checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 3: Run the verification script**

Run: `npx tsx scripts/verify-temperature-unit-scorer.ts`
Expected: five `PASS ...` lines followed by `All temperature-unit-scorer checks passed.` If any check fails, the script throws and exits non-zero — fix `temperature-unit-scorer.ts` (not the script) until all five pass, since the script encodes the scorer's intended behavior from this plan.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors from the two new files.

- [ ] **Step 5: Lint**

Run: `pnpm lint`
Expected: no errors on the two new files.

- [ ] **Step 6: Delete the verification script**

The script in Step 2 exists only to validate this task's logic since the project has no test runner. Remove it now that verification has passed:

```bash
rm scripts/verify-temperature-unit-scorer.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/mastra/scorers/temperature-unit-scorer.ts
git commit -m "feat: add temperature-unit compliance scorer"
```

---

### Task 2: Attach the scorer to `weatherAgent`

**Files:**
- Modify: `src/mastra/agents/weather-agent.ts:1-9,26-38`

**Interfaces:**
- Consumes: `temperatureUnitScorer` from `../scorers/temperature-unit-scorer` (Task 1).
- Produces: `weatherAgent`'s `scorers` option now includes `temperatureUnitCompliance`. No new exports.

- [ ] **Step 1: Add the import**

In `src/mastra/agents/weather-agent.ts`, add the import alongside the existing tool imports:

```ts
import { Agent } from '@mastra/core/agent';
import { ResponseCache } from '@mastra/core/processors';
import { Memory } from '@mastra/memory';
import { ollama } from '../model';
import { responseCache } from '../cache';
import { promptInjectionGuardrail } from '../guardrails';
import { weatherTool } from '../tools/weather-tool';
import { setTemperatureUnitTool } from '../tools/set-temperature-unit-tool';
import { temperatureUnitScorer } from '../scorers/temperature-unit-scorer';
```

- [ ] **Step 2: Add the `scorers` option**

Change the end of the `Agent` constructor from:

```ts
  memory: new Memory({
    options: {
      workingMemory: {
        enabled: true,
        template: `# Preferences\n- Temperature Unit: [celsius | fahrenheit]`,
      },
    },
  }),
});
```

to:

```ts
  memory: new Memory({
    options: {
      workingMemory: {
        enabled: true,
        template: `# Preferences\n- Temperature Unit: [celsius | fahrenheit]`,
      },
    },
  }),
  scorers: {
    temperatureUnitCompliance: {
      scorer: temperatureUnitScorer,
      sampling: { type: 'ratio', rate: 1 },
    },
  },
});
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/mastra/agents/weather-agent.ts
git commit -m "feat: score weatherAgent responses for temperature-unit compliance"
```

---

### Task 3: Register the scorer on the `Mastra` instance and verify end-to-end

**Files:**
- Modify: `src/mastra/index.ts:1-17,73-92`

**Interfaces:**
- Consumes: `temperatureUnitScorer` from `./scorers/temperature-unit-scorer` (Task 1).
- Produces: the `Mastra` instance now exposes `scorers: { temperatureUnitCompliance: temperatureUnitScorer }` for Studio/trace scoring. No new exports.

- [ ] **Step 1: Add the import**

In `src/mastra/index.ts`, add the import alongside the agent/workflow imports:

```ts
import { weatherWorkflow } from "./workflows/weather-workflow";
import { tripPlanReviewWorkflow } from "./workflows/trip-plan-review-workflow";
import { weatherAgent } from "./agents/weather-agent";
import { tripPlannerAgent } from "./agents/trip-planner-agent";
import { temperatureUnitScorer } from "./scorers/temperature-unit-scorer";
```

- [ ] **Step 2: Add the `scorers` option to the `Mastra` constructor**

In `createMastra()`, change:

```ts
  return new Mastra({
    workflows: { weatherWorkflow, tripPlanReviewWorkflow },
    agents: { weatherAgent, tripPlannerAgent },
    server: {
      middleware: studioMiddleware,
    },
```

to:

```ts
  return new Mastra({
    workflows: { weatherWorkflow, tripPlanReviewWorkflow },
    agents: { weatherAgent, tripPlannerAgent },
    scorers: { temperatureUnitCompliance: temperatureUnitScorer },
    server: {
      middleware: studioMiddleware,
    },
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 5: Manual verification via Mastra Studio**

This step requires a local Ollama server running at `http://localhost:11434` with the `llama3.1` model available.

Run: `pnpm studio`
Open `http://localhost:4111`, go to the `weatherAgent`'s Evaluate tab, and confirm `temperatureUnitCompliance` is listed as an attached scorer. Send a chat message like "What's the weather in Berlin?" through Studio's agent chat, then check the Evaluate tab's score results — a new score row should appear with `score: 1` (or `0.5` if the reply omits a tool call) and a reason string. Then ask "Use Fahrenheit" followed by another weather question, and confirm a new score row reflects the Fahrenheit check.

- [ ] **Step 6: Commit**

```bash
git add src/mastra/index.ts
git commit -m "feat: register temperature-unit scorer on the Mastra instance for trace scoring"
```
