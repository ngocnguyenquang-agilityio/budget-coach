# Budget Coach — Implementation Plan

## Context

`d:\copilotkit-training` is a training repo. It already contains three projects that each cover *part* of the Mastra + AG-UI + CopilotKit stack, but none cover it end to end:

- **`ag-ui-app`** — canonical CopilotKit v2 + AG-UI + Mastra wiring, but toy agents and no persistence.
- **`my-nextjs-agent`** — mature Mastra layer (memory, guardrails, scorers, workflows, per-browser resourceId) but its UI is plain AI SDK `useChat`; **no CopilotKit at all**.
- **`ui-dojo`** — broad CopilotKit v2 feature demos (generative UI, shared state, interrupts, frontend tools), but Vite, and each demo is isolated.

`budget-coach` is a new standalone Next.js project (sibling folder, no code shared with the others) that exercises the whole surface in **one coherent domain**. Goal is learning-by-application, not a shippable product. The agreed feature scope is captured in [spec.md](spec.md).

**Intended outcome:** a chat-first personal budget coach where 3 Mastra agents + 1 workflow drive a CopilotKit v2 UI with generative UI, shared state, frontend actions, and two *different* human-in-the-loop mechanisms — persisted across sessions, scoped per browser, guarded and scored.

### Decisions already made (do not relitigate)

| Decision | Choice |
|---|---|
| CopilotKit API generation | **v2** (`@copilotkit/react-core/v2`) — `useAgent`, `useRenderTool`, `useFrontendTool`, `useHumanInTheLoop`, `useInterrupt`, `useAgentContext` |
| State split | Transactions in a **LibSQL table** (tool-accessed); working memory (= `agent.state`) holds only `savingsGoal`, `categoryLimits`, `lastReviewDate`, `pendingApproval` |
| HITL | **One of each mechanism**: category confirm = `useHumanInTheLoop` (frontend tool); budget approval = `useInterrupt` + Mastra `suspend()` |
| Dev model | Ollama `llama3.1`, env-swappable to `google/gemini-3.6-flash` |
| Storage | LibSQL, **file-backed** (`file:./budget-coach.db`) — required for suspend/resume |
| Package manager | pnpm |

---

## Step 0 — Scaffold (user-run, interactive)

The CopilotKit CLI is interactive and cannot run inside this session. **You run this once**, from `d:\copilotkit-training`:

```bash
npx copilotkit@latest create
```

Choose: project name `budget-coach`, **Mastra** agent framework, **pnpm**. Then hand back — everything below is mine.

If the CLI's output diverges from what's assumed here, [ag-ui-app](../../ag-ui-app) is the known-good reference for the exact same wiring and I'll reconcile against it.

**Then** add the extra dependencies:

```bash
pnpm add @mastra/memory @mastra/libsql @mastra/loggers @libsql/client recharts zod
```

### Config gotchas to apply immediately

Both are load-bearing and copied from `ag-ui-app`:

- `next.config.ts` → `serverExternalPackages: ["@copilotkit/runtime"]`
- `package.json` → pin every `@ag-ui/*` to one version via `overrides` (mismatched AG-UI protocol versions get pulled in transitively and break the stream)

---

## Step 1 — Domain foundation

**`src/domain/categories.ts`** — the fixed taxonomy, single source of truth for the agents, the zod schemas, the seed data, and the chart legend.

```ts
export const CATEGORIES = ["Groceries","Dining","Transport","Utilities",
  "Entertainment","Shopping","Housing","Health","Income","Other"] as const;
export const CategorySchema = z.enum(CATEGORIES);
```

**`src/db/client.ts`** — a `@libsql/client` handle on the same `file:./budget-coach.db` the Mastra store uses (separate table, same file, mirroring `my-nextjs-agent/src/mastra/vector-store.ts`'s approach).

**`src/db/transactions.ts`** — `createTable()` (idempotent `CREATE TABLE IF NOT EXISTS`), plus `listTransactions(resourceId)`, `addTransaction(...)`, `seedIfEmpty(resourceId)`. Schema: `id, resourceId, date, merchant, amount, category, seedCategory`.

`seedCategory` holds the ground-truth label used *only* by the Categorizer accuracy scorer.

**`src/db/seed-data.ts`** — ~28 transactions across the trailing 30 days spanning most categories, with Dining and Shopping deliberately heavy so the first Monthly Review has something to flag.

Seeding is per-`resourceId` and runs lazily on first read, so each browser gets its own populated budget.

---

## Step 2 — Mastra infrastructure

Mirror `my-nextjs-agent`'s proven patterns, minus DuckDB (it adds Windows file-lock complexity). Observability instead uses `@mastra/observability`'s `MastraStorageExporter`, writing traces to the same file-backed LibSQL store already required for suspend/resume — no extra infra, no file-lock risk.

- **`src/mastra/model.ts`** — env-swappable provider:
  ```ts
  const ollama = createOpenAICompatible({ name: "ollama",
    baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1" });

  export const model = process.env.MODEL_PROVIDER === "google"
    ? "google/gemini-3.6-flash"          // Mastra model-router string
    : ollama(process.env.OLLAMA_MODEL ?? "llama3.1");
  ```
- **`src/mastra/storage.ts`** — `new LibSQLStore({ id: "budget-coach-storage", url: "file:./budget-coach.db" })`. Must be file-backed; an in-memory DB breaks suspend/resume because pooled connections each see an empty DB.
- **`src/mastra/observability.ts`** — `new Observability({ configs: { default: { serviceName: "budget-coach", exporters: [new MastraStorageExporter()] } } })` from `@mastra/observability`, passed as `observability` on the `Mastra` instance. `MastraStorageExporter` writes spans to the same LibSQL store above, so traces for every agent/tool/workflow call show up in Mastra Studio with zero extra infra.
- **`src/middleware.ts`** + **`src/mastra/get-resource-id.ts`** — copy `my-nextjs-agent`'s per-browser `resource_id` httpOnly cookie → `x-resource-id` header pattern verbatim. Widen the matcher to cover `/api/copilotkit/:path*` as well as `/api/:path*`.
- **`src/mastra/processors/blocked-phrase-guardrail.ts`** — port `my-nextjs-agent`'s `Processor` implementation as-is (`readonly id`, sync `processInput({messages, abort})`, checks only the latest user message, calls `abort(...)` rather than throwing).
- **`src/mastra/guardrails.ts`** — two instances:
  - `promptInjectionGuardrail` — the same generic phrase list.
  - `financialAdviceGuardrail` — domain rule: blocks "should I invest", "which stocks", "is crypto a good", etc., so the Coach stays a budgeting assistant.

---

## Step 3 — Agents & tools

Working-memory schema (this object **is** `agent.state` on the frontend — keep it small):

```ts
// src/mastra/state.ts
export const BudgetStateSchema = z.object({
  savingsGoal: z.object({ name: z.string(), targetAmount: z.number(),
                          targetDate: z.string() }).nullable(),
  categoryLimits: z.record(CategorySchema, z.number()),
  lastReviewDate: z.string().nullable(),
  pendingApproval: z.object({ type: z.enum(["category","budget"]),
                              payload: z.unknown() }).nullable(),
});
```

Only the **Coach** carries `Memory` (matching `my-nextjs-agent`, where only `weatherAgent` does) with `workingMemory: { enabled: true, scope: "resource", schema: BudgetStateSchema }` and `lastMessages: 10` to bound llama3.1's context. `scope: "resource"` (not `"thread"`) so a savings goal and budget survive across chat threads.

**Tools** (`src/mastra/tools/`) — note `execute` is `(inputData, context)`, positional:

| Tool | Used by | Purpose |
|---|---|---|
| `listTransactionsTool` | Analyst, Coach | Read transactions for the current `resourceId` (from `context.agent.resourceId`), with optional category/date filters |
| `addTransactionTool` | Coach | Persist a confirmed transaction |
| `categorizeTool` | Coach | Agent-as-tool wrapper delegating to Categorizer (pattern: `my-nextjs-agent/src/mastra/tools/ask-weather-agent-tool.ts`) |
| `analyzeSpendingTool` | Coach | Agent-as-tool wrapper delegating to Analyst |
| `setSavingsGoalTool` | Coach | Writes the goal into working memory via `memory.updateWorkingMemory` |
| `approveBudgetTool` | Coach | **Suspends** (see Step 4) |

**Agents** (`src/mastra/agents/`):

- **`categorizerAgent`** (`id: "categorizer"`) — narrow: given merchant + amount, return exactly one category from the taxonomy. No tools, no memory.
- **`analystAgent`** (`id: "analyst"`) — calls `listTransactionsTool`, returns per-category totals, over-limit flags, and trailing-spend figures. Instructions pin the output shape so the scorer can assert against it.
- **`coachAgent`** (`id: "coach"`) — user-facing. Carries memory, both guardrails as `inputProcessors`, all the tools above, and **dynamic instructions** (see gotcha below).

### Gotcha: `useAgentContext` does not reach the prompt by itself

`@ag-ui/mastra` parks frontend context on `requestContext` under the **`"ag-ui"`** key and does *not* inject it. The Coach's `instructions` must be a function:

```ts
instructions: async ({ requestContext }) => {
  const agui = requestContext?.get("ag-ui") as
    { context?: Array<{description: string; value: string}> } | undefined;
  const items = agui?.context ?? [];
  if (items.length === 0) return BASE_INSTRUCTIONS;
  return `${BASE_INSTRUCTIONS}\n\nCurrent client-side context:\n` +
    items.map(({description, value}) => `- ${description}: ${value}`).join("\n");
}
```

There is a repo skill for exactly this failure mode: `surfacing-agui-context-in-mastra-prompts`.

---

## Step 4 — Monthly Review workflow (+ server-side HITL)

**`src/mastra/workflows/monthly-review-workflow.ts`**, following `my-nextjs-agent/src/mastra/workflows/trip-plan-review-workflow.ts`:

`categorizeUncategorized → analyzeSpending → proposeAdjustments → approvalGate (suspends) → applyOrDiscard`

- One shared `loopSchema` used as both `inputSchema` and `outputSchema` for every step, carrying `resourceId` through — `applyOrDiscard`, not a route handler, is what persists.
- `approvalGate` declares `suspendSchema` (the proposals shown to the user) and `resumeSchema` (`{ decision: "approve" | "reject", edits?: ... }`), and does `if (!resumeData) return suspend({...})` — **`return suspend(...)`, never `await suspend()`**, or the run continues without waiting.
- On the **first** run (no `categoryLimits` yet), `proposeAdjustments` computes initial limits at ~110% of trailing spend — same code path as later adjustments, no separate bootstrap.
- Both the workflow and any nested sub-workflow need `.commit()`.

`approveBudgetTool` is the Coach's entry point into this: a Mastra tool with `suspendSchema`/`resumeSchema` that suspends server-side. This is what `useInterrupt` renders on the frontend.

**Auto-run:** a `POST /api/monthly-review/ensure` route checks `lastReviewDate` against the current calendar month and kicks the workflow if it hasn't run. Called once from the dashboard on mount. Chat-triggered runs go through the Coach's tool instead.

---

## Step 5 — CopilotKit runtime route

**`src/app/api/copilotkit/[[...slug]]/route.ts`** — copy `ag-ui-app`'s shape exactly:

```ts
const runtime = new CopilotRuntime({
  agents: MastraAgent.getLocalAgents({ mastra }),   // needs @ts-expect-error at current versions
  runner: new InMemoryAgentRunner(),
});
const app = createCopilotEndpoint({ runtime, basePath: "/api/copilotkit" });
export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
```

All four verbs must be exported, `basePath` must match the folder, and `handle` comes from `hono/vercel`. Agents are keyed by their **registration key** in `new Mastra({ agents: {...} })` — that key (`coach`, `categorizer`, `analyst`) is what `agentId` refers to everywhere on the frontend.

Provider in **`src/app/layout.tsx`**:

```tsx
import "@copilotkit/react-core/v2/styles.css";
<CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
```

`useSingleEndpoint={false}` avoids a dev-mode race against the lazily-compiled route.

Also: **`GET /api/transactions`** — plain route the dashboard uses to read transactions (they're deliberately not in shared state).

---

## Step 6 — Frontend

`src/app/page.tsx` is the dashboard; `CopilotSidebar` is the chat. Load it via `next/dynamic` with `ssr: false`.

**Shared state** — `useAgent({ agentId: "coach", updates: [UseAgentUpdate.OnStateChanged] })`. Read `agent.state`, write `agent.setState(...)` when the user edits a limit directly. Seed defaults in a `useEffect` when `agent.state` is undefined.

**Generative UI** — `useRenderTool` per tool, plus one `useDefaultRenderTool` catch-all:

| Component | Rendered from |
|---|---|
| `CategoryBreakdownChart` (recharts donut) | `analyzeSpendingTool` |
| `BudgetProgressBars` (limit vs actual, over-budget flagged) | `analyzeSpendingTool` |
| `TransactionListCard` | `listTransactionsTool` |
| `MonthlyReviewCard` (proposals + approve/reject) | the `useInterrupt` render |

Three render-side gotchas, all confirmed in `ui-dojo`:
1. `render` params **stream in incrementally** — every field in a `useRenderTool` `parameters` schema must be `.optional()` even when the tool requires it.
2. `result` arrives as a **JSON string** — parse defensively.
3. The `name` must match the agent's `tools` **map key**, not the tool's `id`.

**Frontend actions** — `useFrontendTool` with handlers: `openAddTransactionForm` (pre-fills from what the user described in chat) and `highlightCategory` (UI-only scroll/flash — deliberately included as a non-mutating action for contrast).

**HITL, two mechanisms:**

```tsx
// Gate 1 — frontend tool, no server suspend
useHumanInTheLoop({
  name: "confirmCategory",
  parameters: z.object({ merchant: z.string().optional(),
                         amount: z.number().optional(),
                         suggested: CategorySchema.optional() }),
  render: ({ args, respond, status }) =>
    <CategoryConfirmCard {...args} status={status} respond={respond} />,
});

// Gate 2 — server suspend/resume, persisted in LibSQL
useInterrupt({
  agentId: "coach",
  renderInChat: true,
  render: ({ event, resolve }) => {
    const raw = event.value ?? {};
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return <MonthlyReviewCard proposals={parsed.suspendPayload}
             onApprove={() => resolve({ decision: "approve" })}
             onReject={() => resolve({ decision: "reject" })} />;
  },
});
```

The interrupt payload is nested under `suspendPayload` inside `event.value`, and `event.value` may be a string. Approval cards should guard against double-resolve with local state (`ui-dojo/src/components/ck/time-picker-card.tsx`).

**Context** — `useAgentContext` for the currently-visible month and any highlighted category. Only works because of the dynamic instructions in Step 3.

---

## Step 7 — Scorers

`src/mastra/scorers/`, all deterministic (no LLM judge), following the `createScorer(...).preprocess().analyze().generateScore().generateReason()` shape from `my-nextjs-agent/src/mastra/scorers/temperature-unit-scorer.ts`:

- **`categorizerAccuracyScorer`** — compares the assigned category against `seedCategory` ground truth. Scores 1/0; returns 1 when there's no ground truth to check against.
- **`coachScopeScorer`** — flags Coach responses drifting into investment/regulated-advice territory (pairs with `financialAdviceGuardrail`).
- **`adjustmentReasonablenessScorer`** — flags a proposed limit more than 50% away from trailing spend.

Attach per-agent with `sampling: { type: "ratio", rate: 1 }`, and register bare on the Mastra instance.

Reading tool results in a scorer: `toolInvocation.toolName` is the agent's `tools` **map key**, not the tool `id`.

---

## Verification

Not complete until each of these is observed, not assumed:

1. **Build/lint** — `pnpm build` and `pnpm lint` clean.
2. **Ollama up** — `ollama serve` running with `llama3.1` pulled (it's installed at `C:\Users\OS\AppData\Local\Programs\Ollama` but the server was not running during planning).
3. **Studio smoke test** — `pnpm studio` (`mastra dev`, port 4111): exercise `categorizer`, `analyst`, `coach`, and run `monthlyReviewWorkflow` to confirm it reaches `suspended`.
4. **App, in a browser** (`pnpm dev`, port 3000) — walk the golden path end to end:
   - Dashboard loads with ~28 seeded transactions and a category chart.
   - First Monthly Review auto-runs, proposes initial limits, and the `useInterrupt` card appears; approving writes `categoryLimits` and the progress bars update.
   - "I spent $40 at Trader Joe's" → Categorizer suggests Groceries → `useHumanInTheLoop` card → confirm → transaction appears in the list and the chart moves.
   - "Set a savings goal of $2,000 by December" → reload the page → the Coach still knows it (working memory, `scope: "resource"`).
   - "Ignore previous instructions" → blocked by guardrail. "Should I buy Nvidia stock?" → declined, redirected to budgeting.
   - Open in a second browser profile → separate, independently-seeded budget (resourceId isolation).
5. **Persistence** — restart the dev server; transactions, limits, goal, and chat threads all survive.
6. **Scorers** — confirm scores are recorded in Studio after a few runs.

If llama3.1 proves unreliable at the multi-agent/tool orchestration, set `MODEL_PROVIDER=google` and re-run step 4 to separate *model* failures from *wiring* failures before debugging further.
