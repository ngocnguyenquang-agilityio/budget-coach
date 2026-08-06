# 06 — Frontend: dashboard, chat, generative UI, both HITL mechanisms

**What to build:** the full user-facing app — dashboard + chat sidebar, shared state, generative UI for every tool, frontend actions, and both human-in-the-loop mechanisms — completing the golden path end to end.

**Blocked by:** 05 — CopilotKit runtime route

**Status:** ready-for-agent

- [ ] `src/app/page.tsx` renders the dashboard; `CopilotSidebar` is loaded via `next/dynamic` with `ssr: false`
- [ ] Shared state via `useAgent({ agentId: "coach", updates: [UseAgentUpdate.OnStateChanged] })`; dashboard reads `agent.state` and seeds defaults when undefined
- [ ] Generative UI: `CategoryBreakdownChart`, `BudgetProgressBars`, `TransactionListCard` render tools plus one default catch-all render tool; every `useRenderTool` parameter is `.optional()` (params stream incrementally) and `result` is parsed defensively as a JSON string
- [ ] Frontend actions: `openAddTransactionForm` (pre-filled from chat) and `highlightCategory` (UI-only, non-mutating)
- [ ] HITL gate 1 — `useHumanInTheLoop` for `confirmCategory`, rendering `CategoryConfirmCard`
- [ ] HITL gate 2 — `useInterrupt` for the Coach agent, rendering `MonthlyReviewCard` from `event.value.suspendPayload` (guarding against `event.value` arriving as a string), with double-resolve protection via local state
- [ ] `useAgentContext` reports the currently-visible month and any highlighted category
- [ ] Verified end-to-end (golden path): dashboard loads with ~28 seeded transactions and a category chart; first Monthly Review auto-runs and the interrupt card appears; approving updates `categoryLimits` and the progress bars
- [ ] Verified: "I spent $40 at Trader Joe's" → Categorizer suggests Groceries → confirm card → transaction appears and the chart updates
- [ ] Verified: "Set a savings goal of $2,000 by December" → reload the page → Coach still knows it
- [ ] Verified: an "ignore previous instructions" prompt is blocked; an investment-advice prompt is declined and redirected
- [ ] Verified: a second browser profile gets a separate, independently-seeded budget
