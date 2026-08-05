# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is pnpm (see `pnpm-lock.yaml` / `pnpm-workspace.yaml`).

```bash
pnpm dev      # Next.js dev server (http://localhost:3000)
pnpm build    # Production build
pnpm start    # Serve production build
pnpm lint     # ESLint (eslint.config.mjs, flat config extending next/core-web-vitals + next/typescript)
```

There is no test runner configured in this project.

The Mastra backend (agents/workflows/tools under `src/mastra`) runs in-process inside the Next.js API route — there is no separate `mastra dev` server to start for this app to work.

## Architecture

This is a Next.js (App Router) frontend wired to a [Mastra](https://mastra.ai) AI agent backend, using the Vercel AI SDK for streaming chat UI. All Mastra agents/tools/workflows run in-process inside Next.js API routes — there is no separate server to start.

### Agents

- `src/mastra/agents/weather-agent.ts` (id `weather-agent`) — reports current weather via `weatherTool`, and tracks a Fahrenheit/Celsius preference in working memory (`Memory()` with `workingMemory` enabled), settable via `setTemperatureUnitTool`. Scored by `temperatureUnitScorer`.
- `src/mastra/agents/trip-planner-agent.ts` (id `trip-planner-agent`) — builds multi-day itineraries. Always calls `askWeatherAgentTool` (which internally asks `weatherAgent` for current conditions) before writing, then `searchDestinationGuideTool` (semantic search over a small curated city knowledge base in `destinationGuidesVector`, via manual `embed()` + `LibSQLVector.query()` — not `@mastra/rag`'s `createVectorQueryTool`). Scored by `tripItineraryFormatScorer` and `tripToolUsageScorer`.
- Both agents run on Ollama's `llama3.1` (`src/mastra/model.ts`, `createOpenAICompatible` pointed at `http://localhost:11434/v1` — **a local Ollama server must be running**, with `nomic-embed-text` pulled too for the destination-guide embeddings) and share `promptInjectionGuardrail` (`src/mastra/guardrails.ts`, a `BlockedPhraseGuardrail` input processor) and a `ResponseCache` input processor backed by `src/mastra/cache.ts`'s `InMemoryServerCache`.

### Workflows

- `src/mastra/workflows/weather-workflow.ts` (`weatherWorkflow`) — `fetchWeather → planActivities`; fetches a forecast from Open-Meteo directly, then streams an activity plan from `weatherAgent`. Wired to `POST /api/activities`.
- `src/mastra/workflows/trip-plan-review-workflow.ts` (`tripPlanReviewWorkflow`) — drafts an itinerary via `tripPlannerAgent`, then suspends for human approve/revise/discard via a `reviewGate` step before finalizing. Wired to `POST /api/trip-plan-review` (starts the run, streams the draft, expects it to suspend) and `POST /api/trip-plan-review/resume` (resumes with the decision).
- `src/app/api/trip-plan/route.ts` calls `tripPlannerAgent` directly (no workflow) for a plain, non-reviewed itinerary.

### Request flow (chat)

1. `src/app/chat/page.tsx` — client chat UI using `useChat` (`@ai-sdk/react`) with `DefaultChatTransport` pointed at `/api/chat`. On mount it also `GET`s `/api/chat` to hydrate prior conversation history. `src/app/api/threads/` (`route.ts` and `[threadId]/route.ts`) list/create/manage threads.
2. `src/app/api/chat/route.ts` — `POST` pipes the request through `handleChatStream` (`@mastra/ai-sdk`) against the singleton `mastra` instance, using a per-request `threadId` (required body param) and a per-browser `resourceId` (see below). `GET` recalls a thread from agent memory and converts it to AI SDK v5 UI messages via `toAISdkV5Messages`.
3. `src/mastra/index.ts` — constructs the `Mastra` instance: registers both agents, both workflows, and the three scorers above, and configures storage/observability (see below).

There is no auth in this app, so "user identity" is a per-browser id: `src/middleware.ts` runs on every `/api/*` request, assigns a `resource_id` httpOnly cookie on first visit (generated with `crypto.randomUUID()`), and forwards it to route handlers as an `x-resource-id` request header. Route handlers read it via `getResourceId(req)` (`src/mastra/get-resource-id.ts`) rather than importing a shared constant — this scopes working memory, thread listings, and persisted messages to the browser that made the request. `tripPlanReviewWorkflow`'s `resourceId` is threaded through its `loopSchema` (set once when `/api/trip-plan-review` starts the run) since the workflow's `finalize` step, not a route handler, is what persists the approved itinerary.

### Storage & observability

`src/mastra/index.ts` wires a `MastraCompositeStore` with two backends:
- Default store: `LibSQLStore` — `file:./mastra.db` locally, or a hosted Turso DB when `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` are set (deploy via `mastra env db create --kind turso`).
- `observability` domain: `DuckDBStore` (`mastra.duckdb`).

Because DuckDB's C API has no concurrent-writer support but `DuckDBConnection` opens a fresh connection per call, `serializeDuckDbCalls()` monkey-patches `DuckDBConnection.prototype.{query,execute,executeBatch}` to queue all calls through a single promise chain, avoiding "Another write batch or compaction is already active" errors. Keep this in mind if touching storage/observability init — do not call DuckDB methods outside this serialized path.

Observability exports to `MastraStorageExporter` (persisted to the store above) and `MastraPlatformExporter` (only active if `MASTRA_PLATFORM_ACCESS_TOKEN` is set), with `SensitiveDataFilter` redacting secrets from spans.

`*.db*` / `*.duckdb*` files in the repo root are local dev databases — not source, safe to ignore/regenerate.

### UI components

`src/components/ai-elements/` is a large set of prebuilt chat/agent UI primitives (message bubbles, tool call rendering, reasoning, code blocks, canvas/flow nodes via `@xyflow/react`, etc.) — only a subset (`prompt-input`, `conversation`, `message`, `tool`) is currently used by `chat/page.tsx`. `src/components/ui/` is shadcn/ui (config in `components.json`, style `base-nova`, base color `neutral`); use the existing `pnpm dlx shadcn` conventions (aliases `@/components`, `@/lib`, `@/hooks`) rather than hand-writing primitives when adding UI.

`src/app/page.tsx` is still the unmodified `create-next-app` starter page — the real app entry point is `/chat`.

### Environment

`.env` currently only sets `GOOGLE_API_KEY` (unused — both agents run against local Ollama). Turso vars (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`) and `MASTRA_PLATFORM_ACCESS_TOKEN` are optional and only needed for hosted storage/observability.

## Plan execution handoff

See the `plan-execution-handoff` skill (`.claude/skills/plan-execution-handoff/SKILL.md`)
— it overrides `superpowers:writing-plans`' normal execution-mode choice.
