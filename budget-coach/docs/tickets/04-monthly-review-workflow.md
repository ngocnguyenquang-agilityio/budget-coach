# 04 — Monthly Review workflow & server-side HITL

**What to build:** the `categorize → analyze → propose → approve (suspend) → apply` workflow, wired to the Coach's `approveBudgetTool` as its entry point, plus the auto-run trigger — the server-side half of the two HITL mechanisms.

**Blocked by:** 03 — Agents & tools

**Status:** ready-for-agent

- [ ] `monthlyReviewWorkflow` runs `categorizeUncategorized → analyzeSpending → proposeAdjustments → approvalGate → applyOrDiscard`, using one shared schema for input/output carrying `resourceId` through
- [ ] `approvalGate` declares `suspendSchema` (proposals) and `resumeSchema` (`{decision, edits?}`), and uses `return suspend(...)` (never `await suspend()`)
- [ ] On first run (no `categoryLimits` yet), `proposeAdjustments` computes initial limits at ~110% of trailing spend via the same code path as later adjustments
- [ ] The workflow (and any sub-workflow) is `.commit()`ed
- [ ] `approveBudgetTool` on the Coach is fully wired: a Mastra tool with matching `suspendSchema`/`resumeSchema` that suspends server-side
- [ ] `POST /api/monthly-review/ensure` checks `lastReviewDate` against the current calendar month and kicks the workflow if it hasn't run this month
- [ ] Verified in Mastra Studio: running the workflow against seed data reaches `suspended` with proposed limits ~110% of trailing spend
- [ ] Verified in Mastra Studio: resuming with `{decision: "approve"}` persists `categoryLimits` into Coach working memory; resuming with `{decision: "reject"}` discards the proposal
