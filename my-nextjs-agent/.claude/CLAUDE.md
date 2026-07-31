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

This is a Next.js (App Router) frontend wired to a [Mastra](https://mastra.ai) AI agent backend, using the Vercel AI SDK for streaming chat UI.

### Request flow

1. `src/app/chat/page.tsx` — client chat UI using `useChat` (`@ai-sdk/react`) with `DefaultChatTransport` pointed at `/api/chat`. On mount it also `GET`s `/api/chat` to hydrate prior conversation history.
2. `src/app/api/chat/route.ts` — the only API route. `POST` pipes the request through `handleChatStream` (`@mastra/ai-sdk`) against the singleton `mastra` instance, hardcoding a single fixed thread/resource (`THREAD_ID = 'example-user-id'`, `RESOURCE_ID = 'weather-chat'`) — i.e. there is currently no per-user/session thread isolation. `GET` recalls that same thread from agent memory and converts it to AI SDK v5 UI messages via `toAISdkV5Messages`.
3. `src/mastra/index.ts` — constructs the `Mastra` instance: registers `weatherAgent` and `weatherWorkflow`, and configures storage/observability (see below).
4. `src/mastra/agents/weather-agent.ts` — the agent. Model is Ollama's `llama3.1` via `createOpenAICompatible` pointed at `http://localhost:11434/v1` (**a local Ollama server must be running** for chat to work), with `weatherTool` and a per-agent `Memory()` instance.
5. `src/mastra/tools/weather-tool.ts` — geocodes a city name and fetches current weather from the free Open-Meteo API (no API key required).
6. `src/mastra/workflows/weather-workflow.ts` — a separate `fetchWeather → planActivities` Mastra workflow (registered but not wired to any route/UI yet); `planActivities` looks up the agent via `mastra.getAgent('weatherAgent')` and streams an activity plan from it.

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

`.env` currently only sets `GOOGLE_API_KEY` (unused by the wired-up weather agent, which runs against local Ollama). Turso vars (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`) and `MASTRA_PLATFORM_ACCESS_TOKEN` are optional and only needed for hosted storage/observability.

## Plan execution handoff

See the `plan-execution-handoff` skill (`.claude/skills/plan-execution-handoff/SKILL.md`)
— it overrides `superpowers:writing-plans`' normal execution-mode choice.
