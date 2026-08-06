# 05 — CopilotKit runtime route

**What to build:** the HTTP surface that exposes the Mastra agents to a CopilotKit v2 frontend — the AG-UI bridge route, provider wiring, and the plain transactions-read endpoint.

**Blocked by:** 04 — Monthly Review workflow & server-side HITL

**Status:** ready-for-agent

- [ ] `/api/copilotkit/[[...slug]]/route.ts` wires `CopilotRuntime` with `MastraAgent.getLocalAgents({ mastra })` and `InMemoryAgentRunner()`, matching `ag-ui-app`'s shape
- [ ] All four HTTP verbs (`GET`, `POST`, `PATCH`, `DELETE`) are exported via `handle` from `hono/vercel`
- [ ] `basePath` matches the route's folder path
- [ ] `CopilotKit` provider is added to `layout.tsx` with `runtimeUrl="/api/copilotkit"` and `useSingleEndpoint={false}`
- [ ] `GET /api/transactions` returns transactions for the caller's `resourceId` as a plain (non-agent) route
- [ ] Verified: a raw HTTP request to `/api/copilotkit` for the `coach` agentId returns an AG-UI-shaped streaming response
- [ ] Verified: `GET /api/transactions` returns the seeded transactions for a given `resourceId` cookie
