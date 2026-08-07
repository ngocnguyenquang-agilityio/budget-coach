# 03 — Agents & tools (Categorizer, Analyst, Coach)

**What to build:** the three-agent core — a narrow Categorizer, a read-only Analyst, and the user-facing Coach that orchestrates both, carries memory, and is guarded — runnable and inspectable in Mastra Studio.

**Blocked by:** 02 — Mastra infrastructure

**Status:** done

- [x] `categorizerAgent` (`id: "categorizer"`) returns exactly one taxonomy category given a merchant + amount; no tools, no memory
- [x] `analystAgent` (`id: "analyst"`) calls the analyze-transactions tool and returns per-category totals, over-limit flags, and trailing-spend figures in a pinned output shape
- [x] `coachAgent` (`id: "coach"`) carries `Memory` with `workingMemory: { enabled: true, scope: "resource", schema: BudgetStateSchema }` and `lastMessages: 10`
- [x] Coach's `instructions` is a function that reads frontend context from `requestContext.get("ag-ui")` and appends it to the base prompt when present
- [x] Coach has both guardrails wired as `inputProcessors`
- [x] Coach has tools: list transactions, add transaction, categorize (agent-as-tool → Categorizer), analyze spending (agent-as-tool → Analyst), set savings goal (writes to working memory)
- [x] `approveBudgetTool` exists as a stub/placeholder on the Coach — full suspend/resume wiring is deferred to ticket 04
- [x] Verified in Mastra Studio: Categorizer returns a single valid category for a sample merchant/amount
- [x] Verified in Mastra Studio: Analyst returns correct per-category totals against the seed data from ticket 01 — per-category sums (e.g. Groceries 204.02, Dining 236.70, Shopping 425.96, trailingSpend 3106.41) matched the seed data exactly. Initial verification surfaced that local `llama3.1` reliably mis-adds multi-line-item category totals when asked to do the arithmetic itself; fixed by moving the summation into a deterministic `computeAnalysis` function (`src/domain/analysis.ts`, unit-tested) called via a new `analyzeTransactions` tool, so the Analyst's job is only to call the tool and relay its already-correct result — this makes totals exact regardless of model strength, not just with a stronger model.
- [x] Verified in Mastra Studio: telling the Coach a fact (e.g. a savings goal) in one thread and starting a new thread for the same `resourceId` shows the Coach still knows it
