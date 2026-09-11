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
- All new Mastra tools **must** wrap their `execute` with `withToolErrorHandling` from `src/mastra/tools/with-tool-error-handling.ts`. This converts unhandled throws to `{ success: false, error, code: "TOOL_ERROR" }`, which the Coach prompt is instructed to handle. Existing tools that only return structured business-logic errors (and never throw) are exempt.

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
- **`transactions` is migrated in code**, not by a migration tool: `createTable` in `src/db/transactions.ts` probes `PRAGMA table_info` and `ALTER TABLE`s in any missing column. Add new columns there, and give them a default that is correct for existing rows.
- **AG-UI `@ag-ui/*` packages** — all pinned to the same version via `package.json` `overrides`. Mismatched AG-UI protocol versions break the event stream.

### Agent architecture

Three Mastra agents, two workflows:

| Agent | Registration key | Purpose |
|---|---|---|
| `categorizerAgent` | `"categorizer"` | Classifies a transaction into the fixed taxonomy. No tools, no memory. |
| `analystAgent` | `"analyst"` | Reads transactions, returns per-category totals and over-limit flags. |
| `coachAgent` | `"coach"` | User-facing front door. Carries memory, guardrails, and all tools. Orchestrates the other two. |

**Monthly Review workflow** (`monthlyReviewWorkflow`) — `closePeriods → analyzeSpending → proposeAdjustments → approvalGate (suspends) → applyOrDiscard`. Backward-looking.

**Refit workflow** (`refitWorkflow`) — `readLedger → proposeRefit → approvalGate (suspends) → applyOrDiscard`. Forward-looking; runs when the Commitment ledger changes, not on request.

Both use `return suspend(...)` (never `await suspend()`), and both read the **same Cap** — neither derives one of its own.

### The domain model (read `CONTEXT.md` first)

The money model was rebuilt in ADRs 0011–0014, which supersede 0003, 0007, 0009 and 0010. Four rules carry most of the weight:

1. **Every Transaction is `expected` or `received`.** Only `received` rows feed Received Income, Net Savings, the Savings Balance, and a Category's over-limit flag. `computeAnalysis` (`src/domain/analysis.ts`) is the *single* place this filter lives — a missed status filter is silent, so read pre-split figures from it rather than filtering yourself.
2. **Savings Pots are the only savings concept.** No stored `savingsGoal`, no `Target`, no `Declared Income` — all deleted. `setSavingsGoal` is a shorthand that maintains the rate-driven *General Savings* pot; the displayed goal is `sumCommitments(pots, period)`.
3. **One Commitment ledger, one Cap.** `Cap = Forecast Income − sum(pot rates)` via `computeCap` (`src/domain/commitment.ts`). A pot's rate comes only from `potRate`; a target pot re-derives it each Period, so **a Period boundary is itself a Commitment change**.
4. **A tool that changes the ledger returns `refitNeeded: true`** when limits no longer fit; the Coach then calls `refitBudget`. Never trigger a refit without that flag.

Two easily-missed consequences: a pot-funded Expense is excluded from Net Savings but still counts against its Category Limit, and the Cap is only enforced once income is on record (no Income Transactions → accept the Commitment unchecked).

### Working memory schema

Only the **Coach** carries `Memory`. Working memory (`scope: "resource"`, survives across threads) holds:

```ts
{ categoryLimits, lastReviewPeriod, lastClosedPeriod, unallocated, pendingApproval, coachPreferences, savingsPots, pendingAmendments }
```

`pendingAmendments` (ADR-0015) tracks already-closed Periods that have since had a Transaction backdated into them — `{ period, netSavingsAtClose }[]`, one entry per dirty period, with the baseline captured in `addTransactionsTool` **before** the backdated insert (the only moment `computeAnalysis` for that period still equals what was rolled in at close). The next Monthly Review's `closePeriods` step diffs a fresh `computeAnalysis` against that baseline (`computeAmendments` in `src/domain/period-close.ts`) and folds only the delta into `unallocated` — original pot allocations for the amended period are never replayed. An array, not a record, for the same reason `savingsPots` is one: `updateWorkingMemory` merges objects, so only an array is reliably replaced when an entry needs to disappear. Rejecting a review leaves `pendingAmendments` untouched (deferred, not lost, same as a skipped close).

`savingsBalance` is **derived** (pot balances + `unallocated`), never stored — storing both invites them to disagree. Read pots with `parsePots` (`src/domain/savings-pot.ts`), never by parsing the array directly: resources written before ADR-0013 hold the old `savedSoFar` shape, and a raw `BudgetStateSchema.safeParse` on them fails the discriminated union and takes the *entire* state down with it.

`coachPreferences` (`{ verbosity?, nickname?, emphasizedCategories? }`, see ADR-0006) is explicit-only (set via `setCoachPreferenceTool`, never inferred) and can never override a guardrail or suppress required information. It's woven into the Coach's instructions as imperative prose, not dumped as raw JSON — see `buildPreferenceDirectives` in `src/mastra/agents/coach.ts`. Because the `instructions()` callback only receives `{ requestContext, mastra }` (no resourceId/threadId to query working memory directly), the dashboard round-trips `coachPreferences` back through the same `"ag-ui"` frontend-context channel used for UI state, reading it off `agent.state` (already synced from working memory).

Transactions are in LibSQL, not in shared state. `agent.state` on the frontend reads only the working memory object.

### HITL: two mechanisms

1. **`useHumanInTheLoop`** — category confirmation and the savings-amount box. Pure frontend tool, no server suspend. Tool name must match the agent's tools **map key**.
2. **`useInterrupt`** — budget approval from *both* workflows. Server-side `suspend()` in Mastra, persisted to LibSQL. Interrupt payload is nested under `suspendPayload` inside `event.value`, and `event.value` may be a JSON string. A single `useInterrupt` handles both; the payload's `kind` (`"monthly-review"` | `"refit"`) picks the card.

`pendingApproval.workflow` discriminates which workflow owns a suspended run. Guard it **positively** (`workflow && workflow !== "monthly-review"` → not ours), never as a denylist — the retired `"funding-plan"` value still sits in some users' working memory.

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
