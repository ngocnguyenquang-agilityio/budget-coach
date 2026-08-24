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

## Recommendations (not implemented — ranked by priority)

### 1. Tool-level DB/runtime error handling (highest priority)

`listTransactionsTool`, `addTransactionTool`, the analyze-* tools
(`analyze-transactions.ts`, `analyze-spending.ts`), `approveBudgetTool`,
`setSavingsGoalTool`, and `src/db/transactions.ts` itself have no try/catch
around DB or working-memory calls. A LibSQL failure propagates raw into
Mastra's tool-call machinery, which currently just silently closes the SSE
stream (see the agent-level limitation below) — the user sees the response
simply stop, with no explanation.

This is ranked above the workflow fix below because it affects **every**
ordinary chat interaction (logging a transaction, asking for a spending
breakdown), not just the once-a-month Monthly Review flow.

Needs a per-tool design pass, not a mechanical wrap, because the right
fallback differs by tool:
- `listTransactionsTool` failing could reasonably return an empty list +
  an error note, so the Coach can say "I couldn't load your transactions
  right now."
- `addTransactionTool` failing should **not** pretend to succeed — the tool
  result needs to make the failure legible to the Coach so it doesn't tell
  the user a transaction was recorded when it wasn't.
- `approveBudgetTool` / `setSavingsGoalTool` already deliberately throw for
  bad *preconditions* (missing `threadId`, workflow not registered) — those
  throws should stay as-is; only genuine runtime failures (a DB timeout
  during `memory.updateWorkingMemory`) need a different, non-throwing path
  so they're distinguishable from precondition bugs.

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

### 3. `categorize.ts`'s broad catch conflates two different failure modes

```ts
try {
  const result = await categorizerAgent.generate(...);
  ...
} catch {
  return { type: "expense" as const, category: "Other" as const };
}
```

This is meant to catch the documented "weak local model returns
non-structured output" case, but as written it also catches a genuine
Cerebras outage or rate-limit exhaustion and silently degrades to category
"Other" either way — masking a real failure as if it were the benign,
expected case. Recommend narrowing the catch (or checking the error shape)
so only the structured-output-parse failure degrades silently; a genuine
API failure should propagate (or retry) rather than mis-categorize
silently.

### 4. No external error-reporting/alerting service

Logging today is console-only: Mastra's `ConsoleLogger`, one
`console.warn` for guardrail violations (`guardrail-block-channel.ts`), and
vendor `console.error` inside `@copilotkit/runtime`. There's no Sentry/
equivalent, so a failure in production is only visible if someone is
tailing server logs at the time. Not urgent for a local/demo project, but
worth flagging for anything closer to production.

### 5. Agent-level errors are vendor-constrained (known limitation, not fixable from app code)

Beyond `StreamErrorRetryProcessor`'s retry-with-backoff, there is no
app-level handling of a Cerebras call failing inside `coachAgent`,
`analystAgent`, or `categorizerAgent`. Once retries are exhausted, the
error surfaces inside `@copilotkit/runtime`'s SSE handling
(`sse-response.mjs`), which logs server-side and closes the stream —
**no error event is written to the client stream**, so the user just sees
the response stop. This is vendor behavior, not something fixable from
this codebase; noted here so it isn't mistaken for an oversight.

## Explicitly out of scope

- Dedicated error-path test coverage (DB failure simulation, workflow-step
  throw, malformed `useInterrupt` payload, Cerebras timeout) — flagged by
  the audit as essentially absent, but adding it is a separate effort from
  this review.
