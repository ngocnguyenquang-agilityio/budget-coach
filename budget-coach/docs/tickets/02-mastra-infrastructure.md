# 02 — Mastra infrastructure

**What to build:** the shared plumbing every agent needs — an env-swappable model, persistent storage, tracing, per-browser resource identity, and both safety guardrails — so agents built in ticket 03 have something correct to run on.

**Blocked by:** 01 — Domain foundation & seed data

**Status:** done

- [x] Model is env-swappable: defaults to local Ollama `llama3.1`, switches to `google/gemini-3.6-flash` via `MODEL_PROVIDER=google`
- [x] Storage is a file-backed `LibSQLStore` (not in-memory — required later for workflow suspend/resume in ticket 04)
- [x] `Observability` from `@mastra/observability` is registered on the `Mastra` instance with a `MastraStorageExporter`, writing traces to the same file-backed LibSQL store (no DuckDB — avoids Windows file-lock issues)
- [x] A per-browser `resource_id` httpOnly cookie is set and forwarded as `x-resource-id` on requests to `/api/copilotkit/:path*` and `/api/:path*`
- [x] `promptInjectionGuardrail` blocks known manipulation phrases ("ignore previous instructions", etc.)
- [x] `financialAdviceGuardrail` blocks investment/regulated-advice phrasing ("should I invest", "which stocks", "is crypto a good...")
- [x] Verified: two different browser profiles receive two different `resourceId`s (`src/middleware.test.ts`)
- [x] Verified: feeding a blocked phrase to each guardrail's `processInput` in isolation triggers `abort(...)` rather than throwing (`src/mastra/processors/blocked-phrase-guardrail.test.ts`)
- [x] Verified in Mastra Studio: a manual agent call (`POST /api/agents/default/generate`) produced a trace with 10 correlated spans (`agent_run` → `processor_run`/`model_generation` → `model_step` → `model_inference`/`model_chunk`), all sharing one `traceId`
