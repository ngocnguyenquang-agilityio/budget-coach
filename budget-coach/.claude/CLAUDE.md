# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Behavioral guidelines

Adapted from [andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills). Biases toward caution over speed — use judgment on trivial tasks.

1. **Think before coding** — state assumptions explicitly; if multiple interpretations exist, present them instead of picking silently; stop and ask when something is genuinely unclear.
2. **Simplicity first** — minimum code that solves the problem; no speculative features, abstractions, or error handling for impossible scenarios.
3. **Surgical changes** — touch only what the task requires; don't refactor or "improve" adjacent code; match existing style; remove only the imports/vars your own change orphaned.
4. **Goal-driven execution** — turn vague asks into verifiable success criteria (e.g. "fix the bug" → reproduce with a test, then make it pass) and loop until verified, per the Verification checklist below.

## Code style

- Always use arrow functions (`const foo = () => {}`), not `function` declarations.
- Constants (e.g. color palettes, fixed lookup tables) belong in `src/constants/`, not inline in the file that uses them.
- `src/app/**/page.tsx` files must stay thin shells (layout/providers only) — extract any real component (e.g. a `Dashboard`) into `src/components/` and import it.

## Planning requests

If the user's message contains planning-related keywords ("plan", "planning", "roadmap", "design a plan", "implementation plan", "how should we approach") for a non-trivial change, call `EnterPlanMode` first, then delegate the design work to the `planner` subagent (`.claude/agents/planner.md`, runs on Opus, read-only). Present its output to the user for approval via `ExitPlanMode` before writing any code.

## Commands

```bash
# Development (runs both UI on :3000 and Mastra agent server on :4111)
pnpm dev

# UI only
pnpm dev:ui

# Mastra agent server only (Mastra Studio at http://localhost:4111)
pnpm dev:agent

# Debug logging
pnpm dev:debug

# Production build (must pass before completing any feature)
pnpm build
```

**Prerequisite:** `CEREBRAS_API_KEY` must be set in `.env` (get one at cloud.cerebras.ai).

## Dependency versions

Key packages are pinned to their latest **stable** releases as of 2026-08-06: `@ag-ui/mastra` 1.1.1 (up from a `0.2.x` beta), `@mastra/libsql`/`@mastra/memory`/`mastra`/`@mastra/client-js` (up from alpha releases), `@ai-sdk/openai` v4, `zod` v4.

- **`typescript` is pinned to `^6.0.3`, not the `latest` dist-tag (`7.x`).** TypeScript 7 is the native/Go-ported compiler; as of this pin it breaks `next.config.ts` loading (`Cannot read properties of undefined (reading 'fileExists')`) and has an unmet peer dep in Mastra's build tooling (`typescript-paths` wants `^4.7.2 || ^5 || ^6`). Don't bump past `6.x` until the Next.js/Mastra toolchains support the TS7 compiler.
- **`tsconfig.json` sets `"noUncheckedSideEffectImports": false`.** TS 6 defaults this on, which errors on side-effect CSS imports (`import "./globals.css"`) that have no ambient module declaration — Next.js's own type shims only cover `*.module.css`, not plain stylesheet imports. Required for `tsc --noEmit` to pass; `next build` itself doesn't typecheck by default so this only surfaces via explicit `tsc`.
- **`@mastra/client-js`'s transitive `@ai-sdk/ui-utils`** still wants `zod@^3.23.8` and shows as an unmet peer warning after the zod v4 bump. It's an unused legacy dependency path (not exercised by anything in this repo) — safe to ignore until Mastra drops it upstream.

## Architecture

This is a **chat-first personal budget coach** that exercises the full CopilotKit v2 + Mastra + AG-UI stack end to end.

### Data flow

```
Browser → Next.js App Router → /api/copilotkit (Hono/CopilotRuntime)
                                      ↓
                          Mastra agents (in-process, not HTTP)
                                      ↓
                          LibSQL file DB (budget-coach.db)
```

### Key wiring decisions

- **`src/agent.ts`** — exports `createLocalAgents()` which uses `MastraAgent.getLocalAgents({ mastra })` to bridge Mastra agents into AG-UI's `AbstractAgent` interface. The route at `src/app/api/copilotkit/[[...slug]]/route.ts` mounts these. Agents are identified by their **registration key** in `new Mastra({ agents: {...} })`, not the agent's `id` field — this key is what `agentId` refers to everywhere on the frontend.
- **`src/mastra/index.ts`** — `Mastra` instance with all agents registered. Currently registers only `weatherAgent` as `"default"`.
- **CopilotKit v2 API** — import from `@copilotkit/react-core/v2`, not `@copilotkit/react-core`. Hooks: `useAgent`, `useFrontendTool`, `useHumanInTheLoop`, `useInterrupt`, `useAgentContext`, `useConfigureSuggestions`.
- **`CopilotChatConfigurationProvider`** — must be **uncontrolled** (no `threadId` prop) when using `CopilotThreadsDrawer`, so that "+ New" thread works.
- **Storage** — must be file-backed LibSQL (`file:./budget-coach.db`), not in-memory. In-memory breaks suspend/resume because pooled connections each see an empty DB.
- **AG-UI `@ag-ui/*` packages** — all pinned to the same version via `package.json` `overrides`. Mismatched AG-UI protocol versions break the event stream.

### Agent architecture (planned per spec)

Three Mastra agents, one workflow:

| Agent | Registration key | Purpose |
|---|---|---|
| `categorizerAgent` | `"categorizer"` | Classifies a transaction into the fixed taxonomy. No tools, no memory. |
| `analystAgent` | `"analyst"` | Reads transactions, returns per-category totals and over-limit flags. |
| `coachAgent` | `"coach"` | User-facing front door. Carries memory, guardrails, and all tools. Orchestrates the other two. |

**Monthly Review workflow** — `categorizeUncategorized → analyzeSpending → proposeAdjustments → approvalGate (suspends) → applyOrDiscard`. Uses `return suspend(...)` (never `await suspend()`).

### Working memory schema

Only the **Coach** carries `Memory`. Working memory (`scope: "resource"`, survives across threads) holds:

```ts
{ savingsGoal, categoryLimits, lastReviewPeriod, pendingApproval }
```

Transactions are in LibSQL, not in shared state. `agent.state` on the frontend reads only the working memory object.

### HITL: two mechanisms

1. **`useHumanInTheLoop`** — category confirmation. Pure frontend tool, no server suspend. Tool name must match the agent's tools **map key**.
2. **`useInterrupt`** — budget approval from the Monthly Review workflow. Server-side `suspend()` in Mastra, persisted to LibSQL. Interrupt payload is nested under `suspendPayload` inside `event.value`, and `event.value` may be a JSON string.

### Frontend rendering gotchas

- `useRenderTool` parameters **stream in incrementally** — every field in the parameters schema must be `.optional()` even when the tool requires it.
- `result` from a tool arrives as a **JSON string** — parse defensively.
- The `name` in `useRenderTool`/`useFrontendTool` must match the agent's `tools` **map key**, not the tool's `id`.

### Dynamic instructions and `useAgentContext`

`@ag-ui/mastra` parks frontend context under the `"ag-ui"` key in `requestContext`. It does **not** inject it into the prompt automatically. The Coach's `instructions` must be a function that reads `requestContext?.get("ag-ui")` — see Step 3 of `docs/implementation-plan.md` for the exact pattern.

### Per-user isolation

Auth is handled by Clerk (`@clerk/nextjs`); the whole app is gated (`src/middleware.ts` via `clerkMiddleware` + `auth.protect()`, with only `/sign-in(.*)` and `/sign-up(.*)` public). The middleware sets `x-resource-id` to Clerk's `userId`, used **directly** as the Mastra `resourceId` — no `users` table or mapping layer, since `resourceId` is stored as plain `TEXT` everywhere. Working memory uses `scope: "resource"` so goals and limits persist across a user's devices and threads. See `docs/adr/0004-clerk-for-authentication.md`.

## Environment variables

```env
CEREBRAS_API_KEY=         # required — get one at cloud.cerebras.ai
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=  # required — keys from dashboard.clerk.com
CLERK_SECRET_KEY=         # required
LOG_LEVEL=debug           # optional verbose logging

# CopilotKit Intelligence (optional, enables durable threads)
COPILOTKIT_LICENSE_TOKEN=
INTELLIGENCE_API_KEY=
INTELLIGENCE_API_URL=     # default: http://localhost:4201
INTELLIGENCE_GATEWAY_WS_URL= # default: ws://localhost:4401
```

## Verification checklist

Before marking any feature complete:
1. `pnpm build` passes clean
2. Mastra Studio (`pnpm dev:agent`, port 4111) smoke-tests the agent(s) involved
3. In-browser golden path works end to end (see `docs/implementation-plan.md` Step 7)
4. Signing in as the same user in a second browser profile shows the *same* budget (cross-device continuity); a second, distinct user sees an independent, separately-seeded budget (resourceId isolation)
5. Dev server restart preserves transactions, limits, goal, and chat threads
