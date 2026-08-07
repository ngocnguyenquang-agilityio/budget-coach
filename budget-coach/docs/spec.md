# Budget Coach — Spec

Standalone learning project (sibling folder to `ag-ui-app`, `my-nextjs-agent`, `ui-dojo`, no shared code) that exercises the full CopilotKit v2 + Mastra + AG-UI stack end to end, in one coherent domain: a chat-first personal budget coach. Supersedes the original grilling-session planning doc now that [implementation-plan.md](implementation-plan.md) has settled the remaining technical decisions.

## Problem Statement

There's no single project in the training repo that exercises the whole Mastra + AG-UI + CopilotKit v2 surface together — `ag-ui-app` has the canonical wiring but toy agents and no persistence, `my-nextjs-agent` has a mature Mastra layer but no CopilotKit UI, and `ui-dojo` has broad CopilotKit demos but they're isolated and non-persistent. Learning the stack end to end (multi-agent orchestration, a suspendable workflow, two different HITL mechanisms, generative UI, shared state, per-browser persistence, guardrails, and scorers) requires seeing them all wired together in one realistic domain.

## Solution

Build `budget-coach`, a chat-first personal budget coach: a Next.js app where a user talks to a Coach agent about their spending, gets transactions auto-categorized (with confirmation), sees visual budget breakdowns, and goes through a monthly review that proposes new limits for approval. Three Mastra agents (`categorizer`, `analyst`, `coach`) and one workflow (`monthlyReviewWorkflow`) sit behind a CopilotKit v2 UI, with state and transaction history persisted per-browser in a file-backed LibSQL store so nothing resets on refresh.

## User Stories

1. As a user, I want to tell the assistant what I bought in plain English ("I spent $40 at Trader Joe's"), so that I don't have to fill out a form to log a transaction.
2. As a user, I want every transaction to be auto-categorized into a fixed taxonomy (Groceries, Dining, Transport, Utilities, Entertainment, Shopping, Housing, Health, Income, Other), so that I don't have to categorize my own spending.
3. As a user, I want to be asked to confirm the suggested category before it's saved, so that a miscategorized purchase never slips through silently.
4. As a user, I want a quick-add-transaction form that pre-fills from what I just typed in chat, so that I can log a purchase with one click instead of typing every field.
5. As a user, I want to see a visual breakdown (chart) of where my money is going by category, so that I can understand my spending at a glance.
6. As a user, I want to see progress bars comparing my spending against my limits per category, so that I can tell which categories are close to or over budget.
7. As a user, I want the assistant to automatically review my spending once a month and propose updated budget limits based on how I've actually been spending, so that my limits stay realistic without me having to recompute them myself.
8. As a user, I want to explicitly approve or reject a proposed budget adjustment, so that nothing about my budget changes without my say-so.
9. As a user, I want to trigger a monthly review on demand ("run my monthly review") instead of waiting for the automatic monthly trigger, so that I can check in whenever I want.
10. As a first-time user with no budget limits yet, I want the first monthly review to propose sensible starting limits from my seeded transaction history, so that I'm not left with an empty budget.
11. As a user, I want to tell the assistant about a savings goal (e.g. "saving $2,000 for a trip by December") and have it remember that goal across separate conversations, so that I don't have to repeat myself every session.
12. As a user, I want my transaction history, budget limits, savings goal, and chat threads to persist across page refreshes and dev-server restarts, so that nothing resets unexpectedly.
13. As a user opening the app in a different browser, I want to see my own separate, independently-seeded budget rather than someone else's, so that budgets stay isolated without requiring a login.
14. As a user, I want the assistant to refuse prompts that try to override its instructions (e.g. "ignore previous instructions"), so that it stays trustworthy.
15. As a user, I want the assistant to decline to give real investment/financial advice (e.g. "should I buy Nvidia stock?") and redirect me back to budgeting, so that it doesn't overstep into regulated advice it's not qualified to give.
16. As a developer, I want deterministic scorers (no LLM judge) evaluating categorization accuracy, on-topic scope, and budget-adjustment sanity, so that regressions in agent quality are caught automatically after every run.
17. As a developer, I want every agent/tool/workflow call traced to Mastra Studio via `@mastra/observability`, so that I can debug orchestration without extra infrastructure.
18. As a developer, I want to swap the LLM provider between local Ollama (`llama3.1`) and Google Gemini via an env var, so that I can develop offline and still have a path to a hosted model.
19. As a user, I want to see the assistant's current spending analysis and any highlighted category reflected in what it says, so that its answers are grounded in what I'm actually looking at on the dashboard.

## Implementation Decisions

### Agents & tools

- Three Mastra agents: `categorizerAgent` (registration key `"categorizer"`, no tools/memory — given merchant + amount, returns exactly one taxonomy category), `analystAgent` (`"analyst"` — calls `listTransactionsTool`, returns per-category totals, over-limit flags, trailing-spend figures in a shape scorers can assert against), `coachAgent` (`"coach"` — the only agent carrying `Memory`, all tools, both guardrails, and dynamic instructions).
- Agents are looked up everywhere on the frontend by their **registration key** in `new Mastra({ agents: {...} })`, not the agent's `id` field.
- Tools (positional `execute(inputData, context)`): `listTransactionsTool`, `addTransactionTool`, `categorizeTool` (agent-as-tool wrapper delegating to Categorizer), `analyzeSpendingTool` (agent-as-tool wrapper delegating to Analyst), `setSavingsGoalTool` (writes into working memory), `approveBudgetTool` (suspends into the Monthly Review workflow).
- The Coach's `instructions` must be a function reading `requestContext?.get("ag-ui")` — `@ag-ui/mastra` parks frontend context there and does not inject it into the prompt automatically.

### State & persistence

- Transactions live in a LibSQL table (`id, resourceId, date, merchant, amount, category, seedCategory`), tool-accessed, not in shared state. `seedCategory` is ground truth used only by the categorizer accuracy scorer.
- Working memory (`scope: "resource"`, so it survives across chat threads) is the only thing exposed as `agent.state` on the frontend: `{ savingsGoal, categoryLimits, lastReviewDate, pendingApproval }`. Only the Coach carries this memory, with `lastMessages: 10` to bound context for `llama3.1`.
- Storage must be file-backed LibSQL (`file:./budget-coach.db`) — an in-memory DB breaks suspend/resume because pooled connections each see an empty DB.
- Per-browser isolation via an httpOnly `resource_id` cookie mapped to an `x-resource-id` header in Next.js middleware, covering `/api/copilotkit/:path*`. Seed data (~28 transactions across the trailing 30 days, Dining and Shopping deliberately heavy) is seeded lazily per-`resourceId` on first read.
- Initial budget limits are not pre-seeded; the first Monthly Review proposes them from seed-transaction history (~110% of trailing spend) via the same code path as later adjustments — no separate bootstrap.

### Monthly Review workflow

- Steps: `categorizeUncategorized → analyzeSpending → proposeAdjustments → approvalGate (suspends) → applyOrDiscard`.
- One shared `loopSchema` used as both `inputSchema` and `outputSchema` for every step, carrying `resourceId` through; `applyOrDiscard` (not a route handler) is what persists the outcome.
- `approvalGate` uses `return suspend(...)`, never `await suspend()` — the latter lets the run continue without waiting for a response.
- A `POST /api/monthly-review/ensure` route checks `lastReviewDate` against the current calendar month and kicks the workflow if it hasn't run this month; called once from the dashboard on mount. Chat-triggered runs ("run my monthly review") go through the Coach's `approveBudgetTool` instead.

### HITL — two distinct mechanisms

1. **Category confirmation** — `useHumanInTheLoop` frontend tool (`confirmCategory`), no server suspend. Tool name must match the agent's `tools` map key.
2. **Budget approval** — `useInterrupt` + Mastra `suspend()`/`resume()` from the Monthly Review workflow, persisted in LibSQL so it survives a refresh. The interrupt payload is nested under `suspendPayload` inside `event.value`, and `event.value` may arrive as a JSON string that needs defensive parsing.

### Frontend / CopilotKit v2

- API surface: `@copilotkit/react-core/v2` — `useAgent`, `useRenderTool`, `useFrontendTool`, `useHumanInTheLoop`, `useInterrupt`, `useAgentContext`, `useConfigureSuggestions`.
- Shared state via `useAgent({ agentId: "coach", updates: [UseAgentUpdate.OnStateChanged] })`; dashboard reads `agent.state`, writes `agent.setState(...)` for direct limit edits.
- Generative UI (`useRenderTool` per tool + one `useDefaultRenderTool` catch-all): `CategoryBreakdownChart` (recharts donut, from `analyzeSpendingTool`), `BudgetProgressBars` (from `analyzeSpendingTool`), `TransactionListCard` (from `listTransactionsTool`), `MonthlyReviewCard` (from the `useInterrupt` render).
- Frontend actions via `useFrontendTool`: `openAddTransactionForm` (pre-fills from chat), `highlightCategory` (UI-only, non-mutating, included deliberately for contrast with mutating actions).
- Three confirmed render-side gotchas: every `useRenderTool` `parameters` field must be `.optional()` because params stream in incrementally even when the tool requires them; tool `result` arrives as a JSON string and must be parsed defensively; the `name` passed to `useRenderTool`/`useFrontendTool` must match the agent's `tools` map key, not the tool's `id`.
- `CopilotChatConfigurationProvider` must stay uncontrolled (no `threadId` prop) for `CopilotThreadsDrawer`'s "+ New" thread to work.
- `useAgentContext` feeds the currently-visible month and any highlighted category into `requestContext`; only reaches the model because of the dynamic-instructions wiring on the Coach.

### CopilotKit runtime route

- `src/app/api/copilotkit/[[...slug]]/route.ts` mounts `MastraAgent.getLocalAgents({ mastra })` via `CopilotRuntime` + `createCopilotEndpoint`, exporting all four verbs (`GET`/`POST`/`PATCH`/`DELETE`) via `hono/vercel`'s `handle`. `basePath` must match the route folder.
- `useSingleEndpoint={false}` on the `<CopilotKit>` provider, to avoid a dev-mode race against the lazily-compiled route.
- A separate plain `GET /api/transactions` route serves the dashboard directly — transactions are deliberately not part of shared state.

### Guardrails

- `promptInjectionGuardrail` — generic phrase-list `Processor`, checks only the latest user message, calls `abort(...)` rather than throwing.
- `financialAdviceGuardrail` — domain-specific: blocks investment/stock/crypto-advice phrasing so the Coach stays a budgeting assistant, not a financial advisor.
- Both attached to the Coach as `inputProcessors`.

### Observability & model provider

- `@mastra/observability`'s `MastraStorageExporter` writes traces to the same file-backed LibSQL store already required for suspend/resume — no DuckDB, no extra infra, avoids Windows file-lock issues.
- Model is env-swappable: local Ollama `llama3.1` for dev (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`), Google Gemini (`google/gemini-3.6-flash`) via `MODEL_PROVIDER=google` for anywhere Ollama isn't available. Deploy target/platform is out of scope.

## Testing Decisions

- All scorers are **deterministic** (`createScorer(...).preprocess().analyze().generateScore().generateReason()`, no LLM judge), following the shape of `my-nextjs-agent/src/mastra/scorers/temperature-unit-scorer.ts`.
- `categorizerAccuracyScorer` — compares the assigned category against `seedCategory` ground truth; scores 1/0, returns 1 when there's no ground truth to check against. Attached to the Categorizer.
- `coachScopeScorer` — flags Coach responses drifting into investment/regulated-advice territory; pairs with `financialAdviceGuardrail` as a scored signal on top of the hard block. Attached to the Coach.
- `adjustmentReasonablenessScorer` — flags a proposed budget limit more than 50% away from trailing spend. Attached to the workflow's `proposeAdjustments` step.
- All scorers attached per-agent with `sampling: { type: "ratio", rate: 1 }` and registered bare on the `Mastra` instance so they're visible in Mastra Studio.
- Reading tool-call results inside a scorer: `toolInvocation.toolName` is the agent's `tools` map key, not the tool's `id` — same footgun as the render-side tool-name matching.
- No end-to-end UI test suite is in scope; UI-level correctness is verified manually against the golden path in `implementation-plan.md`'s Verification section (Studio smoke tests for each agent + the workflow reaching `suspended`, then a full in-browser walkthrough covering categorization, monthly review approval, savings-goal persistence, guardrail blocking, and second-browser resourceId isolation).
- **One integration-test seam**, below the UI, calling the Mastra agents/workflow directly (`mastra.getAgent("coach").generate(...)`, and running `monthlyReviewWorkflow` through to `suspended` then resuming it) rather than through the CopilotKit HTTP route. This is the seam that catches wiring regressions the scorers can't (a tool `tools`-map key silently renamed, `suspend()` accidentally becoming `await suspend()`, the Coach's dynamic-instructions function no longer reading `requestContext.get("ag-ui")`) — failures the scorers would miss because they only judge output quality, not whether the plumbing ran at all. It is the single highest seam available that still exercises real orchestration: below it (unit-testing individual tools) misses cross-agent wiring; above it (browser/e2e) is out of scope per the golden-path walkthrough already covering that ground manually.

## Out of Scope

- Multi-currency / i18n — currency is hardcoded USD.
- User authentication or multi-user accounts beyond per-browser `resourceId` isolation (no login, no user records).
- Deployment platform selection (Vercel, etc.) — only the env-var-driven model-provider swap (Ollama ↔ Gemini) is prepared; hosting/CI is not addressed.
- Any code sharing with `ag-ui-app`, `my-nextjs-agent`, or `ui-dojo` — patterns are mirrored, not imported.
- Real financial/investment advice — explicitly blocked by `financialAdviceGuardrail`, not a feature gap to fill later.

## Further Notes

- This is a learning-by-application project — the measure of success is exercising the full stack (multi-agent orchestration, both HITL mechanisms, generative UI, shared state, guardrails, scorers, tracing, per-browser persistence) correctly, not shipping a production budgeting product.
- `ag-ui-app` is the fallback reference if the CopilotKit CLI scaffold output diverges from what's assumed in `implementation-plan.md`.
- Two known non-obvious failure modes are already named with a fix on file: `useAgentContext` context not reaching the prompt (`surfacing-agui-context-in-mastra-prompts`), and the `suspend()` vs `await suspend()` workflow bug.
- This spec was generated from `implementation-plan.md` rather than a fresh interview; work is already broken into tickets under `docs/tickets/01-07`, one per implementation-plan step. No issue-tracker publish was performed as part of this update — `docs/agents/issue-tracker.md` isn't present in this repo yet and `glab` isn't installed in this environment, so the triage-label workflow described in `to-spec` doesn't apply here.
