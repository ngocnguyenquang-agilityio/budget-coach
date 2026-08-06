# 03 — Agents & tools (Categorizer, Analyst, Coach)

**What to build:** the three-agent core — a narrow Categorizer, a read-only Analyst, and the user-facing Coach that orchestrates both, carries memory, and is guarded — runnable and inspectable in Mastra Studio.

**Blocked by:** 02 — Mastra infrastructure

**Status:** ready-for-agent

- [ ] `categorizerAgent` (`id: "categorizer"`) returns exactly one taxonomy category given a merchant + amount; no tools, no memory
- [ ] `analystAgent` (`id: "analyst"`) calls the list-transactions tool and returns per-category totals, over-limit flags, and trailing-spend figures in a pinned output shape
- [ ] `coachAgent` (`id: "coach"`) carries `Memory` with `workingMemory: { enabled: true, scope: "resource", schema: BudgetStateSchema }` and `lastMessages: 10`
- [ ] Coach's `instructions` is a function that reads frontend context from `requestContext.get("ag-ui")` and appends it to the base prompt when present
- [ ] Coach has both guardrails wired as `inputProcessors`
- [ ] Coach has tools: list transactions, add transaction, categorize (agent-as-tool → Categorizer), analyze spending (agent-as-tool → Analyst), set savings goal (writes to working memory)
- [ ] `approveBudgetTool` exists as a stub/placeholder on the Coach — full suspend/resume wiring is deferred to ticket 04
- [ ] Verified in Mastra Studio: Categorizer returns a single valid category for a sample merchant/amount
- [ ] Verified in Mastra Studio: Analyst returns correct per-category totals against the seed data from ticket 01
- [ ] Verified in Mastra Studio: telling the Coach a fact (e.g. a savings goal) in one thread and starting a new thread for the same `resourceId` shows the Coach still knows it
