# Design: `setTemperatureUnitTool`

## Purpose

Add a second example tool to `weatherAgent` that demonstrates a tool touching
agent *state* (Mastra working memory) rather than an external API, and have
that state visibly affect a later response — the user tells the agent their
preferred temperature unit once, and subsequent weather answers respect it.

## Mechanism

Mastra's `Memory` supports *working memory*: a small block of text/JSON
attached to a thread/resource that Mastra automatically injects into the
agent's system prompt on every turn, and which persists via whatever store
the `Memory` instance already uses. `weatherAgent`'s `Memory()` currently has
working memory disabled (the default). Enabling it reuses the existing
`LibSQLStore` wiring in `src/mastra/index.ts` — no new storage plumbing.

Mastra also ships an auto-managed `updateWorkingMemory` tool once working
memory is enabled, but using only that wouldn't produce an explicit tool
example to point to. Instead we write our own tool that calls
`memory.updateWorkingMemory()` directly, and rely on Mastra's built-in
read-side (auto-injection into the system prompt) rather than also writing a
custom read tool.

## Changes

### 1. `src/mastra/agents/weather-agent.ts`

- Enable working memory on the existing `Memory()` instance with a markdown
  template:

  ```
  # Preferences
  - Temperature Unit: [celsius | fahrenheit]
  ```

- Extend `instructions` to tell the agent to consult this preference and, when
  set to Fahrenheit, convert `weatherTool`'s Celsius output before presenting
  it to the user (Open-Meteo always returns Celsius, so conversion happens
  agent-side, not in the tool).
- Register the new tool in the agent's `tools: {}` map.

### 2. New file: `src/mastra/tools/set-temperature-unit-tool.ts`

`setTemperatureUnitTool`:

- `inputSchema`: `{ unit: z.enum(['celsius', 'fahrenheit']) }`
- `outputSchema`: `{ unit: z.enum(['celsius', 'fahrenheit']), saved: z.boolean() }`
- `execute`: reads `threadId` / `resourceId` off the tool execution context
  (`context.agent`), resolves the agent's `Memory` instance via
  `context.mastra.getAgentById('weather-agent').getMemory()`, and calls
  `memory.updateWorkingMemory({ threadId, resourceId, workingMemory })` with
  the rendered template string (replace semantics — the whole block is
  rewritten each call, matching template-mode working memory).

## Out of scope

- No changes to `weatherTool` itself.
- No new UI.
- No persistence changes beyond what `Memory()` already provides once working
  memory is enabled.
- No custom read-back tool — reading happens implicitly via Mastra's
  system-prompt injection of working memory.

## Testing

Manual: start the app (`pnpm dev`, Ollama running), in the chat say "use
Fahrenheit from now on", confirm the tool call happens, then ask for weather
in a city and confirm the reported temperature is in Fahrenheit and matches a
Celsius→Fahrenheit conversion of the raw API value.
