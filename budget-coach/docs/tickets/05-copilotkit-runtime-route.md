# 05 — CopilotKit runtime route

**What to build:** the HTTP surface that exposes the Mastra agents to a CopilotKit v2 frontend — the AG-UI bridge route, provider wiring, and the plain transactions-read endpoint.

**Blocked by:** 04 — Monthly Review workflow & server-side HITL

**Status:** done

- [x] `/api/copilotkit/[[...slug]]/route.ts` wires `CopilotRuntime` with `MastraAgent.getLocalAgents({ mastra })` and `InMemoryAgentRunner()`, matching `ag-ui-app`'s shape
- [x] All four HTTP verbs (`GET`, `POST`, `PATCH`, `DELETE`) are exported via `handle` from `hono/vercel` — implemented via `createCopilotRuntimeHandler` from `@copilotkit/runtime/v2` instead, the current stable v2 API's own handler (no hono dependency in this version); it still exports all four verbs pointing at the same handler
- [x] `basePath` matches the route's folder path (`/api/copilotkit`)
- [x] `CopilotKit` provider is added to `layout.tsx` with `runtimeUrl="/api/copilotkit"` and `useSingleEndpoint={false}`
- [x] `GET /api/transactions` returns transactions for the caller's `resourceId` as a plain (non-agent) route
- [x] Verified: a raw HTTP request to `/api/copilotkit` for the `coach` agentId returns an AG-UI-shaped streaming response
- [x] Verified: `GET /api/transactions` returns the seeded transactions for a given `resourceId` cookie
