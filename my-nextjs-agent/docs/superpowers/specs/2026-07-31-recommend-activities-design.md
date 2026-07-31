# Recommend Activities — Design

## Goal

Wire up the existing, already-built but unused `weatherWorkflow`
(`fetchWeather` → `planActivities` in `src/mastra/workflows/weather-workflow.ts`)
to the chat UI, as a dedicated action distinct from normal conversational chat.

## Trigger

A "Suggest activities" button rendered on the weather tool-call card
(`ToolOutput` in `src/app/chat/page.tsx`) whenever that tool's output includes
a `location`. Clicking it runs the workflow for that city.

## Backend

- New route `src/app/api/activities/route.ts` (`POST`), accepting
  `{ city, threadId }`.
- Runs `weatherWorkflow` via `handleWorkflowStream` (`@mastra/ai-sdk`),
  returning an AI-SDK-compatible `UIMessageChunk` stream, same pattern as the
  existing `/api/chat` route.
- After the workflow completes, persist the final activity-plan text to
  Mastra memory for `threadId`/`RESOURCE_ID` (same resource id used by
  `/api/chat`) as a new assistant message, tagged so the client can render it
  as an "Activity Plan" card on reload — so it survives refresh, consistent
  with normal chat history.
- `planActivities` step keeps calling `weatherAgent` to generate the
  formatted plan; no changes to the conversational agent path or its tools.

## Frontend

- New small `ActivityPlanCard` component: visually distinct from a normal
  assistant bubble (bordered card, activity icon/label).
- Button click does a manual `fetch('/api/activities', ...)`, then consumes
  the streamed response (AI SDK's `readUIMessageStream` or equivalent) to
  progressively render the plan into a new `ActivityPlanCard` appended to
  `messages`, live as tokens arrive.
- Loading state is local to the clicked button (disabled + spinner) — doesn't
  block the rest of the chat.
- On error (workflow throws — e.g. city not found, Ollama unreachable), show
  an inline error state in the card rather than crashing the chat.

## Out of scope

- No changes to `weatherAgent`'s instructions or tools.
- No new agent tool for activities.
- Workflow logic itself (`fetchWeather`/`planActivities` steps) is reused
  as-is aside from streaming/persistence wiring.
