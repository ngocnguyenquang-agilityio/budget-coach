# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**UI Dojo** — a Mastra showcase that integrates one Mastra backend with three AI UI frameworks (Vercel **AI SDK**, **Assistant UI**, **CopilotKit**) plus the **Mastra Client SDK**. Each page in `src/pages/` is a self-contained demo of one pattern (generative UI, workflows, agent networks, human-in-the-loop, shared state, observational memory, etc.). Treat pages as reference implementations: they are meant to be read and compared, not deduplicated.

## Commands

- `pnpm run dev` — run **both** the Mastra server (port 4750) and the Vite dev server concurrently. This is the normal way to run the app; the frontend is useless without the backend.
- `pnpm run mastra:dev` / `pnpm run vite:dev` — run either half alone.
- `pnpm run vite:build` — production build (`tsc -b` typecheck + Vite build). Use this to verify TypeScript compiles.
- `pnpm run mastra:build` / `pnpm run mastra:start` — build/run the Mastra server bundle.
- `pnpm run lint` — ESLint. `pnpm run format` — Prettier (double quotes, default config).
- **No test suite exists.** Do not invent test commands.

Requires Node 20+ and an `OPENAI_API_KEY` (copy `.env.example` → `.env`). Most agents use the Mastra Gateway (`mastra/openai/...` model ids via `MASTRA_GATEWAY_API_KEY`); some use OpenAI directly (`openai/...`).

## Architecture

Two halves in one repo, connected over HTTP:

- **Backend** — `src/mastra/`, a single `Mastra` instance in [src/mastra/index.ts](src/mastra/index.ts). This is the source of truth for what the server exposes: every agent, workflow, and API route is registered here. Runs on **port 4750** (non-default, to avoid clashing with other local Mastra servers).
- **Frontend** — `src/` (Vite + React 19 + React Router 7). [src/App.tsx](src/App.tsx) is the route table; each route renders one demo page. The frontend reaches the backend via `MASTRA_BASE_URL` ([src/constants.ts](src/constants.ts), default `http://localhost:4750`, overridable with `VITE_MASTRA_BASE_URL`).

### Backend layout (`src/mastra/`)

- `agents/` — one file per `Agent`. `ck/agents.ts` holds the CopilotKit demo agents (ids prefixed `ck_`, e.g. `ck_agentic_chat`), each heavily commented explaining the specific behavior it demonstrates.
- `tools/` and `ck/tools.ts` — `createTool` definitions (Zod-schema'd), imported by agents.
- `workflows/` — multi-step `Workflow`s (activities, order fulfillment, approval/suspend-resume, branching, agent-text-stream).
- `storage.ts` — a **shared, file-backed** LibSQL store (`file:./.mastra-demo.db`, or `TURSO_DATABASE_URL`). File-backed on purpose: an in-memory DB breaks suspend/resume and background-tasks demos because pooled connections each get an empty DB. All Memory-backed agents share this one store.
- API routes are registered in `index.ts` `server.apiRoutes`:
  - `chatRoute` / `workflowRoute` / `networkRoute` from `@mastra/ai-sdk` — the AI SDK & Assistant UI demos.
  - `registerCopilotKit` (`/copilotkit`) plus custom variants `copilotkit-om-route.ts` (`/copilotkit-om`, `/copilotkit-bg`) and `copilotkit-mcp-route.ts` (`/copilotkit-mcp`) — these wrap `registerCopilotKit` to expose options it doesn't surface directly (observational-memory events, `untilIdle` for background tasks, MCP-apps middleware).
  - `jsonRenderStreamRoute` — custom route in `routes/`.

### Frontend layout (`src/`)

- `pages/<framework>/<demo>.tsx` — one demo each. A page connects to the backend by referencing an agent id and a route URL (e.g. CopilotKit pages wrap `<CopilotKit runtimeUrl={`${MASTRA_BASE_URL}/copilotkit`} agent="ck_...">`; AI SDK pages hit `/chat/:agentId` etc.). When adding a demo, wire the route in `App.tsx` **and** register its agent/route in `mastra/index.ts`.
- `components/ui/` — shadcn/ui primitives ("new-york" style, `@/components/ui`).
- `components/ai-elements/` — AI SDK Elements (installed from the `@ai-elements` registry in [components.json](components.json)).
- `components/assistant-ui/`, `components/ck/` — framework-specific chat components (Assistant UI thread, CopilotKit cards/panels).
- `hooks/`, `lib/` (`cn()` in `lib/utils.ts`, json-render catalog), `constants.ts`.

### Key cross-cutting facts

- **Client-side frontend tools**: some agents call tools that execute in the browser (e.g. `change_background`, `set_theme`). The agent declares intent; the page provides the handler (`useFrontendTool` / AI SDK client tools). Both sides must agree on the tool name and schema.
- **Generative / tool-rendering UI**: agents return tool results; pages render them with custom React components (`useRenderTool`, etc.) rather than printing text — agent instructions often say "do NOT repeat tool data in text."
- The `mastra@1.18.1` dependency is **patched** (`patches/mastra@1.18.1.patch`) via pnpm; `@assistant-ui/tap` is pinned via pnpm override. Keep these in mind when changing versions.
- Two Zod versions coexist: `zod` v4 and `zodv3` (aliased `npm:zod@3`). Use the one the surrounding file imports.
- React Compiler is enabled (`babel-plugin-react-compiler` in [vite.config.ts](vite.config.ts)) — avoid patterns that break its rules.

## Conventions

- Import from `src` via the `@/*` alias (e.g. `@/components/ui/button`).
- Prefer `type` over `interface`; TypeScript strict mode. Named exports. Functional components with extracted prop types.
- Files kebab-case; components PascalCase; functions/vars camelCase.
- Merge Tailwind classes with `cn()` from `@/lib/utils`; component variants via `class-variance-authority`.
- Reusable UI → `components/ui`; AI-specific UI → `components/ai-elements`. Agents → `mastra/agents`, tools → `mastra/tools`, workflows → `mastra/workflows`.
