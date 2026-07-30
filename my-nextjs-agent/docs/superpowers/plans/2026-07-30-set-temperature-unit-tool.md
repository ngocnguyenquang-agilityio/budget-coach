# Set Temperature Unit Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `setTemperatureUnitTool` to `weatherAgent` that writes a user's preferred temperature unit into Mastra working memory, and have the agent respect that preference when reporting weather.

**Architecture:** Enable working memory (markdown template) on `weatherAgent`'s existing `Memory()` instance so Mastra auto-injects it into the system prompt every turn. Add a new tool file that writes to it via `memory.updateWorkingMemory()`, resolving `threadId`/`resourceId` and the `Memory` instance from the tool's own execution context. Update the agent's instructions to read the injected preference and convert `weatherTool`'s Celsius output to Fahrenheit when needed.

**Tech Stack:** Mastra (`@mastra/core`, `@mastra/memory`), Zod, TypeScript. No test runner is configured in this project (confirmed in `.claude/CLAUDE.md`) — verification steps use `pnpm lint`, `npx tsc --noEmit`, and manual exercise via `pnpm dev` instead of automated tests.

## Global Constraints

- Package manager is pnpm — use `pnpm` for all script invocation, not `npm`/`yarn`.
- No test runner exists in this project — do not add one; verify via typecheck/lint/manual run instead.
- A local Ollama server (`http://localhost:11434`, model `llama3.1`) must be running for any manual chat verification to work.
- Follow the existing tool pattern in `src/mastra/tools/weather-tool.ts` (`createTool` from `@mastra/core/tools`, Zod schemas, `execute` returning a plain object).
- Working memory must use **template** (markdown) mode, not schema mode — `memory.updateWorkingMemory()` takes `workingMemory: string`, and mixing template/schema modes on one `Memory` instance is unsupported.

---

### Task 1: Enable working memory on `weatherAgent` and update instructions

**Files:**
- Modify: `src/mastra/agents/weather-agent.ts`

**Interfaces:**
- Consumes: nothing new — `Memory` from `@mastra/memory` is already imported.
- Produces: a working-memory template that Task 2's tool writes to and that the model reads via automatic system-prompt injection. The template's canonical line format is exactly:
  `- Temperature Unit: celsius` or `- Temperature Unit: fahrenheit`
  (Task 2's tool must render this exact line format so the agent can parse it.)

- [ ] **Step 1: Update the `Memory()` instantiation to enable working memory**

In `src/mastra/agents/weather-agent.ts`, replace:

```ts
  memory: new Memory(),
```

with:

```ts
  memory: new Memory({
    options: {
      workingMemory: {
        enabled: true,
        template: `# Preferences\n- Temperature Unit: [celsius | fahrenheit]`,
      },
    },
  }),
```

- [ ] **Step 2: Extend the agent's `instructions` to use the preference**

In the same file, change the `instructions` string from:

```ts
  instructions: `You are a helpful weather assistant that provides accurate weather information and can help planning activities based on the weather.

Your primary function is to help users get weather details for specific locations. When responding:
- Always ask for a location if none is provided
- If the location name isn't in English, please translate it
- If giving a location with multiple parts (e.g. "New York, NY"), use the most relevant part (e.g. "New York")
- Include relevant details like humidity, wind conditions, and precipitation
- Keep responses concise but informative
- If the user asks for activities and provides the weather forecast, suggest activities based on the weather forecast.
- If the user asks for activities, respond in the format they request.

Use the weatherTool to fetch current weather data.`,
```

to:

```ts
  instructions: `You are a helpful weather assistant that provides accurate weather information and can help planning activities based on the weather.

Your primary function is to help users get weather details for specific locations. When responding:
- Always ask for a location if none is provided
- If the location name isn't in English, please translate it
- If giving a location with multiple parts (e.g. "New York, NY"), use the most relevant part (e.g. "New York")
- Include relevant details like humidity, wind conditions, and precipitation
- Keep responses concise but informative
- If the user asks for activities and provides the weather forecast, suggest activities based on the weather forecast.
- If the user asks for activities, respond in the format they request.

Use the weatherTool to fetch current weather data. weatherTool always returns temperature and feelsLike in Celsius.

You have a "Temperature Unit" preference available in your working memory (Preferences section). If the user asks to use Fahrenheit (or Celsius), call setTemperatureUnitTool with that unit to save it. When reporting weather, check your working memory's Temperature Unit: if it is set to fahrenheit, convert weatherTool's Celsius values to Fahrenheit (F = C * 9/5 + 32) before presenting them and label them °F; otherwise present the Celsius values as-is and label them °C.`,
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (the file still won't compile cleanly until Task 2 adds `setTemperatureUnitTool` to the `tools` map — if Task 1 is checked in isolation before Task 2, expect no errors here since `tools: { weatherTool }` is unchanged in this task).

- [ ] **Step 4: Commit**

```bash
git add src/mastra/agents/weather-agent.ts
git commit -m "feat: enable working memory for temperature unit preference on weatherAgent"
```

---

### Task 2: Add `setTemperatureUnitTool`

**Files:**
- Create: `src/mastra/tools/set-temperature-unit-tool.ts`
- Modify: `src/mastra/agents/weather-agent.ts:1-4,27` (import + register in `tools`)

**Interfaces:**
- Consumes: the working-memory template line format from Task 1 (`- Temperature Unit: <unit>`), the agent id `'weather-agent'` (matches `id: 'weather-agent'` in `weather-agent.ts`), and Mastra's `ToolExecutionContext` shape (`context.agent?.threadId`, `context.agent?.resourceId`, `context.mastra`).
- Produces: `setTemperatureUnitTool`, a `createTool(...)` result with:
  - `id: 'set-temperature-unit'`
  - `inputSchema: z.object({ unit: z.enum(['celsius', 'fahrenheit']) })`
  - `outputSchema: z.object({ unit: z.enum(['celsius', 'fahrenheit']), saved: z.boolean() })`
  This is imported and added to `weatherAgent`'s `tools` map under the key `setTemperatureUnitTool`.

- [ ] **Step 1: Create the tool file**

Create `src/mastra/tools/set-temperature-unit-tool.ts`:

```ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const setTemperatureUnitTool = createTool({
  id: 'set-temperature-unit',
  description:
    "Save the user's preferred temperature unit (celsius or fahrenheit) so future weather responses use it.",
  inputSchema: z.object({
    unit: z.enum(['celsius', 'fahrenheit']).describe('The temperature unit the user prefers'),
  }),
  outputSchema: z.object({
    unit: z.enum(['celsius', 'fahrenheit']),
    saved: z.boolean(),
  }),
  execute: async (inputData, context) => {
    const threadId = context.agent?.threadId;
    const resourceId = context.agent?.resourceId;

    if (!threadId) {
      throw new Error('setTemperatureUnitTool requires a threadId (must be called within an agent run)');
    }

    const agent = context.mastra?.getAgentById('weather-agent');
    const memory = await agent?.getMemory();

    if (!memory) {
      throw new Error('weather-agent has no Memory instance configured');
    }

    await memory.updateWorkingMemory({
      threadId,
      resourceId,
      workingMemory: `# Preferences\n- Temperature Unit: ${inputData.unit}`,
    });

    return { unit: inputData.unit, saved: true };
  },
});
```

- [ ] **Step 2: Register the tool on the agent**

In `src/mastra/agents/weather-agent.ts`, add the import alongside the existing `weatherTool` import:

```ts
import { weatherTool } from '../tools/weather-tool';
import { setTemperatureUnitTool } from '../tools/set-temperature-unit-tool';
```

and update the `tools` field:

```ts
  tools: { weatherTool, setTemperatureUnitTool },
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: no errors on the two touched/created files.

- [ ] **Step 5: Commit**

```bash
git add src/mastra/tools/set-temperature-unit-tool.ts src/mastra/agents/weather-agent.ts
git commit -m "feat: add setTemperatureUnitTool for persisting temperature unit preference"
```

---

### Task 3: Manual end-to-end verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: the running app (`pnpm dev`) and the `weatherAgent` from Tasks 1–2.
- Produces: confirmation the feature works; no code changes expected unless verification uncovers a bug, in which case fix in the relevant file from Task 1 or 2 and re-run this task.

- [ ] **Step 1: Start dependencies**

Ensure Ollama is running locally with `llama3.1` pulled (`http://localhost:11434`). Then run:

Run: `pnpm dev`
Expected: Next.js dev server starts on `http://localhost:3000` with no startup errors.

- [ ] **Step 2: Set the preference via chat**

Open `http://localhost:3000/chat` and send: `Please use Fahrenheit for temperatures from now on.`

Expected: the assistant's response includes a tool call to `set-temperature-unit` (visible in the tool UI) with `unit: "fahrenheit"`, and the tool result shows `saved: true`.

- [ ] **Step 3: Request weather and confirm unit conversion**

In the same conversation, send: `What's the weather in London?`

Expected: the assistant calls `weatherTool`, then reports the temperature labeled `°F`. Manually compute the expected Fahrenheit value from the raw Celsius `weatherTool` output (visible in the tool result panel) using `F = C * 9/5 + 32` and confirm the assistant's stated value matches within rounding.

- [ ] **Step 4: Confirm the preference persists across a new message**

Send a second weather question for a different city, e.g. `What's the weather in Paris?`, without restating the unit preference.

Expected: the response again reports Fahrenheit, confirming the preference was read back from working memory rather than only honored in the same turn it was set.

- [ ] **Step 5: Reset and confirm default behavior**

Send: `Switch back to Celsius.` then ask for weather in a third city.

Expected: `set-temperature-unit` is called again with `unit: "celsius"`, and the following weather response reports `°C` values matching `weatherTool`'s raw output directly (no conversion).
