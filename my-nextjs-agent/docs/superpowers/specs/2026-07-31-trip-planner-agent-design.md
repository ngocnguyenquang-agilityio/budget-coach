# Trip Planner Agent (Multi-Agent Orchestration) — Design

## Goal

Add a second Mastra agent, `tripPlannerAgent`, that produces a multi-day trip
itinerary by delegating weather lookups to the existing `weatherAgent` via
Mastra's agent-as-tool pattern. This is a learning/demo feature: the app
currently only exercises a single agent, tools, working memory, one workflow,
storage, and observability — it has no example of one agent calling another.

## Trigger

A "Plan my trip" button rendered inside the existing `ActivityPlanCard`
(`src/components/activity-plan.tsx`), which already appears after a user
clicks "Suggest activities" on a weather result. Clicking "Plan my trip"
reveals a small inline day-count control (1–7, default 3); confirming it
starts the itinerary generation for that city.

## Architecture

```
User clicks "Plan my trip" (city, days) on an ActivityPlanCard
  → POST /api/trip-plan { city, days, threadId }
    → tripPlannerAgent.stream(...)
      → tool: askWeatherAgentTool({ city })
        → weatherAgent.stream([{ role: 'user', content: "what's the weather in {city}?" }])
        ← weather description (accumulated .textStream text)
      ← tripPlannerAgent reasons over that + writes a {days}-day itinerary
    ← streamed back to client as UIMessageChunks
  → new TripPlanCard appended to chat, persisted to memory like activity plans
```

`askWeatherAgentTool` wraps a `weatherAgent.stream()` call (accumulating its
`.textStream`) as a plain Mastra tool so `tripPlannerAgent`'s own
tool-calling loop can invoke it — this is the agent-as-tool pattern: from
`tripPlannerAgent`'s perspective it's just another tool with a text output,
no different from any API-backed tool.

## Backend

1. **`src/mastra/tools/ask-weather-agent-tool.ts`** — new tool
   `askWeatherAgentTool`. Input schema `{ city: string }`. `execute` calls
   `weatherAgent.stream([{ role: 'user', content: ... }], { toolChoice: 'auto' })`
   and accumulates `.textStream` into a string to return as the tool output —
   the same call shape `planActivities` already uses in
   `weather-workflow.ts:151-166`, rather than the unverified `.generate()`
   method (nothing in this codebase currently calls `.generate()` on an
   Agent, so `.stream()` + `.textStream` is the proven path).
   - No `threadId`/`resourceId` is passed through to `weatherAgent`, so this
     call always uses `weatherAgent`'s default units (Celsius) rather than
     whatever °F/°C preference is stored in that thread's working memory.
     This is an intentional simplification, not an oversight — passing
     thread/resource context between agents is out of scope for this feature.
   - If this inner call throws (city not found, Ollama unreachable), `execute`
     catches it and returns a short string describing the failure (e.g.
     `"Could not get weather for {city}: {message}"`) rather than letting the
     exception propagate. This keeps `tripPlannerAgent`'s tool-calling loop
     intact — the outer agent sees a tool result it can react to (e.g. tell
     the user it couldn't get weather data) instead of the whole run
     crashing on a tool exception.

2. **`src/mastra/agents/trip-planner-agent.ts`** — new agent
   `tripPlannerAgent`:
   - Same Ollama model (`llama3.1` via the existing `createOpenAICompatible`
     client) as `weatherAgent`.
   - No `Memory` — this agent is invoked as a single one-shot generation per
     button click, not a back-and-forth conversation, so it doesn't need
     working memory or thread recall.
   - `tools: { askWeatherAgentTool }`.
   - Instructions direct it to: always call `askWeatherAgentTool` first for
     the requested city; then produce a day-by-day itinerary for the
     requested number of days, varying activities and pacing per day while
     being explicit that it's reusing a single current-conditions snapshot
     (Open-Meteo, via `weatherTool`, only exposes "now," not a multi-day
     forecast) rather than claiming day-specific forecasts it doesn't have.
   - The itinerary template's leading marker for each day is a fixed emoji
     prefix distinct from the activity plan's `📅`, e.g. `🧳 Day N —` (exact
     string TBD at implementation time, but it must be a fixed, agent-emitted
     prefix so `isTripPlanMessage`'s reload-time text heuristic can match on
     it, mirroring how `isActivityPlanMessage` matches on `📅`).
   - The request to `/api/trip-plan` (see below) sets
     `toolChoice: { type: 'tool', toolName: 'askWeatherAgentTool' }` on the
     agent's first turn so the model is forced to call the weather tool
     before generating the itinerary, rather than relying solely on
     instructions against a small local model — matching the precedent of
     `weather-workflow.ts:158` explicitly setting `toolChoice`, just to force
     a call instead of suppress one.

3. Register `tripPlannerAgent` in `src/mastra/index.ts`'s `agents` map
   (alongside `weatherAgent`).

4. **`src/app/api/trip-plan/route.ts`** (`POST`) — accepts
   `{ city, days, threadId }` (all required; 400 if missing, matching
   `/api/activities`'s validation style). Unlike `/api/chat` (which goes
   through `@mastra/ai-sdk`'s `handleChatStream` for a full conversational
   turn) or `/api/activities` (which fakes streaming by chunking an
   already-complete workflow result), this route does **real** token
   streaming of a single one-shot agent call using the same primitives
   `/api/activities` already uses: build a `createUIMessageStream({ execute })`,
   call `tripPlannerAgent.stream([{ role: 'user', content: <prompt with city
   and days> }], { toolChoice: { type: 'tool', toolName: 'askWeatherAgentTool' } })`
   (same call shape as `askWeatherAgentTool` and `planActivities` use), and as
   chunks arrive on the result's `.textStream` (per `weather-workflow.ts:151-166`),
   `writer.write({ type: 'text-delta', id: messageId, delta: chunk })` for
   each one — i.e. the same `writer.write` calls `/api/activities` makes
   around its pre-split chunks, just fed from a live stream instead of a
   pre-chunked static string. Wrap with `start`/`text-start`/`text-end`/`finish`
   writes exactly as `/api/activities` does. Pipe the result through
   `createUIMessageStreamResponse`, matching the existing response shape.
   After the stream completes, persist the accumulated itinerary text to
   Mastra memory for `threadId`/`RESOURCE_ID` (same resource id used
   elsewhere) as a new assistant message, mirroring `persistActivityPlan` —
   including reusing its same memory source, `mastra.getAgentById('weather-agent').getMemory()`.
   Since `tripPlannerAgent` has no `Memory` of its own (§2), persistence for
   both activity plans and trip plans goes through `weatherAgent`'s memory
   store, keyed by the shared `threadId`/`RESOURCE_ID` — trip plans aren't
   stored in some separate memory tied to `tripPlannerAgent`. Tag the
   persisted message as recognizable as a trip plan rather than an activity
   plan (see the fixed leading-emoji marker above).

## Frontend

- **`src/components/trip-plan.tsx`** — new module mirroring
  `src/components/activity-plan.tsx`:
  - `isTripPlanMessage(message)` — recognizes trip-plan messages (metadata
    tag when freshly created; a distinct text-based heuristic, e.g. a
    different leading marker in the itinerary template, for messages recalled
    after reload).
  - `TripPlanCard` — bordered card visually distinct from `ActivityPlanCard`
    (different icon/label, e.g. "Trip Itinerary").
  - `PlanTripButton` — button that, on click, reveals a small inline
    day-count stepper (1–7, default 3). Confirming calls
    `fetch('/api/trip-plan', { city, days, threadId })`, consumes the
    streamed response with `readUIMessageStream` (same
    `parseJsonEventStream` + `TransformStream` plumbing as
    `SuggestActivitiesButton`), and progressively appends/updates a new
    `TripPlanCard` in `messages` as tokens arrive. Loading state is local to
    the button (disabled + spinner); on error, flips to an inline "Try again"
    state without disturbing the rest of the chat.

- **Wiring into `ActivityPlanCard`**: `PlanTripButton` renders inside
  `ActivityPlanCard`, which needs the city to plan for. `SuggestActivitiesButton`
  already receives `city` as a prop when it creates the activity-plan message;
  its `onMessage` callback (`src/components/activity-plan.tsx:88-90`) will
  additionally stamp `city` into that message's client-side `metadata`
  alongside `kind: 'activity-plan'`. `ActivityPlanCard` reads
  `message.metadata.city` and passes it to `PlanTripButton`.

  **Known limitation**: this metadata is client-side only — it is not part of
  what `persistActivityPlan` writes to Mastra memory (only the plain message
  text is persisted). So after a page reload, restored `ActivityPlanCard`s
  still render correctly (via the existing text-based heuristic in
  `isActivityPlanMessage`), but won't show a "Plan my trip" button, since the
  city can't be recovered from the persisted text alone. This is accepted as
  a scope boundary for this feature rather than solved — solving it would
  mean persisting structured metadata through the memory-saving path, which
  is a larger change affecting the existing activity-plan persistence too.

- Wiring the new button's `sendMessage`-adjacent flow (it calls a mutation
  endpoint from inside chat UI, similar to the existing pattern) should follow
  the `guarding-streaming-ui-actions` skill's guidance during implementation.

## Error handling

Same posture as the existing activity-plan flow:
- Client: fetch/stream errors are caught, the button flips to a "Try again"
  state, no half-rendered card is left behind.
- Server: errors from `tripPlannerAgent` (e.g. `askWeatherAgentTool` failing
  because the city isn't found, or Ollama being unreachable) propagate as a
  stream error that the client's `catch` handles the same way.

## Out of scope

- No day-specific/multi-day weather forecasts — a single current-conditions
  snapshot is reused and varied across the itinerary, with instructions
  telling the agent not to overclaim.
- No cross-agent memory/preference passthrough (temperature unit chosen in
  the weather chat does not affect `tripPlannerAgent`'s output).
- No changes to `weatherAgent`'s own instructions, tools, or memory.
- No changes to the existing `weatherWorkflow` / activity-plan feature beyond
  the small `metadata.city` addition described above.
- No persistence of trip-plan-specific structured metadata (city, day count)
  to Mastra memory — only the itinerary text is persisted, consistent with
  how activity plans are persisted today.
