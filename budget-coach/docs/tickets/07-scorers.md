# 07 — Scorers

**What to build:** deterministic scorers attached to the relevant agents, giving observable quality signal in Mastra Studio without an LLM judge.

**Blocked by:** 03 — Agents & tools (only needs the agents to exist; can be picked up in parallel with 04–06, doesn't need the workflow or frontend)

**Status:** ready-for-agent

- [ ] `categorizerAccuracyScorer` compares the assigned category against `seedCategory` ground truth (1/0), scoring 1 when there's no ground truth to check against
- [ ] `coachScopeScorer` flags Coach responses drifting into investment/regulated-advice territory (pairs with `financialAdviceGuardrail`)
- [ ] `adjustmentReasonablenessScorer` flags a proposed limit more than 50% away from trailing spend
- [ ] Each scorer follows the `createScorer(...).preprocess().analyze().generateScore().generateReason()` shape
- [ ] Scorers are attached per-agent with `sampling: { type: "ratio", rate: 1 }` and registered bare on the Mastra instance
- [ ] Any scorer reading tool results does so via the agent's `tools` map key, not the tool's `id`
- [ ] Verified in Mastra Studio: scores are recorded after a few runs of Categorizer, Coach, and the Monthly Review proposal step
