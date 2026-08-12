# 08 — Integration test: agent & workflow orchestration

**What to build:** an automated integration-test seam, below the UI, that calls the Mastra agents and workflow directly rather than through the CopilotKit HTTP route — the one seam that catches wiring regressions the deterministic scorers (ticket 07) can't, because scorers judge output quality, not whether the plumbing ran at all.

**Blocked by:** 04 — Monthly Review workflow & server-side HITL (needs the Coach's tools and the workflow to exist; does not need the frontend (05/06) or scorers (07), so it can run in parallel with those)

**Status:** implemented — see `src/mastra/integration.test.ts`

- [x] A direct call to `coachAgent.generate(...)` (bypassing the CopilotKit route) triggers a tool call and asserts the invoked tool resolves via the agent's `tools` map key, not the tool's `id`
- [x] Running `monthlyReviewWorkflow` against seed data drives it through to `suspended`, asserting the `suspendSchema` payload shape (proposed limits ~110% of trailing spend on first run)
- [x] Resuming the suspended run with `{decision: "approve"}` asserts `categoryLimits` is persisted into Coach working memory
- [x] Resuming the suspended run with `{decision: "reject"}` asserts no `categoryLimits` change is persisted
- [x] A regression check for the `suspend()` vs `await suspend()` footgun: the workflow run genuinely pauses at `approvalGate` (does not complete) until resumed
- [x] A regression check for the dynamic-instructions gotcha: a `coachAgent.generate(...)` call passing `requestContext` with an `"ag-ui"` context entry produces a prompt that includes that context (verifiable via a mocked/inspectable model call or an instructions-function unit call)
- [x] Verified: the full suite runs headless (no browser, no running dev server) via a single test command (`pnpm test`)
