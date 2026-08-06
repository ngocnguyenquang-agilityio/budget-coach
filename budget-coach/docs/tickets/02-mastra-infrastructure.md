# 02 — Mastra infrastructure

**What to build:** the shared plumbing every agent needs — an env-swappable model, persistent storage, per-browser resource identity, and both safety guardrails — so agents built in ticket 03 have something correct to run on.

**Blocked by:** 01 — Domain foundation & seed data

**Status:** ready-for-agent

- [ ] Model is env-swappable: defaults to local Ollama `llama3.1`, switches to `google/gemini-3.6-flash` via `MODEL_PROVIDER=google`
- [ ] Storage is a file-backed `LibSQLStore` (not in-memory — required later for workflow suspend/resume in ticket 04)
- [ ] A per-browser `resource_id` httpOnly cookie is set and forwarded as `x-resource-id` on requests to `/api/copilotkit/:path*` and `/api/:path*`
- [ ] `promptInjectionGuardrail` blocks known manipulation phrases ("ignore previous instructions", etc.)
- [ ] `financialAdviceGuardrail` blocks investment/regulated-advice phrasing ("should I invest", "which stocks", "is crypto a good...")
- [ ] Verified: two different browser profiles receive two different `resourceId`s
- [ ] Verified: feeding a blocked phrase to each guardrail's `processInput` in isolation triggers `abort(...)` rather than throwing
