# Error handling review

An audit of how errors are currently handled across the stack (API routes,
Mastra agents/tools, the Monthly Review workflow, frontend, auth middleware,
logging), plus what was fixed in this pass versus left as a recommendation.

**Target behavior** (agreed scope for this review): graceful degradation on
the user-facing chat surface, fail-loud in logs/dev tooling.

## Summary

| Area | Level before this pass |
|---|---|
| API route layer | Some-but-incomplete — vendor library wraps the CopilotKit route; the 4 hand-written routes had none |
| Mastra agents | Some — retry-only (`StreamErrorRetryProcessor`), no app-level try/catch |
| Mastra tools | Some-but-incomplete — inconsistent across tools |
| Monthly Review workflow | Essentially zero |
| Frontend | Some-but-incomplete — one real gap (`useInterrupt` parse) |
| Auth/middleware | Essentially zero explicit handling — relies on Clerk internals |
| Logging/observability | Some — console-based, no external error-reporting service |
| Tests | Essentially zero error-path coverage |

## Fixed in this pass

These were mechanical, low-risk fixes with no real design ambiguity:

- **`src/components/dashboard.tsx`** — `useInterrupt`'s `JSON.parse(raw)` is
  now wrapped in try/catch (matches the pattern already used everywhere else
  — `parseToolResult`, `parseWorkingMemory`). A malformed suspend payload now
  falls through to the empty-state Monthly Review card instead of crashing
  the render.
- **`src/components/add-transaction-form.tsx`** — checks `res.ok` and shows
  an inline error message; the form stays open on failure and `onSaved`/
  `onClose` only fire on a confirmed 2xx response. Previously the form
  silently closed and reported success regardless of what the server
  returned.
- **`src/app/error.tsx`** — a root-level Next.js error boundary (App
  Router's `error.tsx` convention) with a minimal "Something went wrong —
  Reload" fallback. Previously an uncaught render error anywhere (including
  the `useInterrupt` gap above) white-screened the app; now it degrades to a
  recoverable fallback.
- **`src/app/api/transactions/route.ts`, `src/app/api/threads/route.ts`,
  `src/app/api/threads/[threadId]/route.ts`,
  `src/app/api/threads/[threadId]/title/route.ts`,
  `src/app/api/working-memory/route.ts`** — all wrapped with a new
  `withErrorHandling` helper (`src/lib/with-error-handling.ts`) that catches
  any unhandled throw (e.g. `getResourceId`'s missing-header guard, a LibSQL
  failure), logs it via `console.error`, and returns a consistent
  `{ error: string }` JSON 500 — mirroring the shape the vendor CopilotKit
  route already uses. Malformed request bodies (`POST /transactions`,
  `PATCH /threads/[threadId]`) get their own explicit 400 rather than
  falling into the generic 500.
- **`src/middleware.ts`** — replaced the `userId!` non-null assertion with
  an explicit guard that throws a clear error if `userId` is somehow missing
  after `auth.protect()` succeeds, instead of silently forwarding the
  literal string `"null"` as a resourceId.

## Recommendations

### 1. Tool-level DB/runtime error handling — ✅ DONE

**Resolved since this review.** Every Coach tool now wraps its `execute` with
`withToolErrorHandling` (`src/mastra/tools/with-tool-error-handling.ts`), which
converts an unhandled throw into `{ success: false, error, code: "TOOL_ERROR" }`
— the shape the Coach prompt is instructed to handle — while re-throwing a
`ToolPreconditionError` so genuine precondition bugs stay distinguishable from
runtime failures. The per-tool fallbacks this review called for all landed:
- `listTransactionsTool` catches its own DB failure and returns an empty list +
  an error note ("Couldn't load your transactions right now.").
- `addTransactionsTool` surfaces partial-batch failures via a `failed[]` field,
  so the Coach never claims a transaction was recorded when it wasn't.
- `categorizeBatchTool` no longer swallows a genuine Cerebras failure as an
  all-"Other" result (see #3 below).

Originally captured the pre-`withToolErrorHandling` state, when
`listTransactionsTool`, `addTransactionsTool`, the analyze-* tools,
`approveBudgetTool`, and `setSavingsGoalTool` had no try/catch around DB or
working-memory calls.

### 2. Monthly Review workflow has no failure path

None of the 5 steps (`categorizeUncategorized → analyzeSpending →
proposeAdjustments → approvalGate → applyOrDiscard`) have try/catch or a
defined failure branch. A thrown error mid-workflow (e.g. a DB failure in
`analyzeSpending`, or `approvalGate` throwing before it ever calls
`suspend()`) crashes the run outright, and there's no recovery path for an
orphaned suspended run — a risk `approve-budget.ts`'s own comments already
flag ("a second trigger before the first is decided would... orphan the
first suspended run") without addressing it. Recommend adding an explicit
failure/cancel step and a way to discard or re-trigger a stale suspended
run.

### 3. `categorize.ts`'s broad catch conflates two different failure modes — ✅ DONE

**Resolved.** The broad `try/catch` that degraded to "Other" on any error was
removed; `categorizeBatchTool.execute` is now wrapped with
`withToolErrorHandling`. The two failure modes are handled distinctly:
- Weak model returned but produced no valid structured object
  (`result.object` undefined) — the benign case — still degrades to
  expense/"Other" via `reconcileBatchCategories`, no throw.
- A genuine API/network/rate-limit failure throws (after
  `StreamErrorRetryProcessor` exhausts its retries) and surfaces as
  `{ success: false, code: "TOOL_ERROR" }`, so the Coach reports the failure
  instead of silently mis-categorizing every item.

### 4. No external error-reporting/alerting service — ⚠️ SEAM ADDED (no vendor wired)

A shared reporter seam now exists at `src/lib/report-error.ts`: `reportError`
logs to the console (the prior behavior) and, when `ERROR_REPORTING=on`, hands
the error to a single forwarding hook — so wiring an actual service (Sentry,
etc.) is a one-function change rather than touching every call site. The API
route wrapper (`src/lib/with-error-handling.ts`), tool error tracing
(`traceToolError`), and the Coach `run()` error path (`src/agent.ts`) all funnel
through it. **Still open:** no third-party service is wired in yet.

### 5. Agent-level errors — ✅ app-controllable path now handled; ⚠️ vendor mid-stream unchanged

The user-visible half is fixed. The `run()` wrapper in `src/agent.ts` now emits
`COACH_ERROR_FALLBACK` on a `RUN_ERROR` terminal event with no assistant text
(previously that path emitted nothing, so the reply silently stopped) and
reports the error through the seam above. The message is worded explicitly as a
failure, so it surfaces the error rather than masking it as a successful reply.

**Still vendor-constrained:** an error that surfaces *mid-stream* inside
`@copilotkit/runtime`'s SSE handling (`sse-response.mjs`) — rather than as a
`RUN_ERROR` event this wrapper sees — is still logged server-side and closes the
stream with no client event. That path isn't reachable from app code.

## Explicitly out of scope

- Dedicated error-path test coverage (DB failure simulation, workflow-step
  throw, malformed `useInterrupt` payload, Cerebras timeout) — flagged by
  the audit as essentially absent, but adding it is a separate effort from
  this review.
