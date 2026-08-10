# 09 — Bug: chat fails with "Thread ... not found", threads drawer stuck on "Loading threads…"

**What's broken:** in the browser, sending any message in the `CopilotSidebar` (talking to the `"default"` / `weatherAgent`) fails with a red `agent_run_error_event` — `Thread <uuid> not found` (`runtimeErrorCode: INCOMPLETE_STREAM`). The `CopilotThreadsDrawer` in the left sidebar never resolves past `"Loading threads…"`.

**Blocks:** 06 — Frontend (dashboard, chat, generative UI, both HITL mechanisms) can't be manually verified in-browser until this is resolved — raw HTTP checks against `/api/copilotkit` pass, but nothing routed through the actual `CopilotKit`/`CopilotSidebar`/`CopilotThreadsDrawer` React components works.

**Status:** ready-for-agent

## Reproduction

1. `pnpm dev`, open `http://localhost:3000`.
2. Left sidebar shows "Loading threads…" indefinitely (never resolves, no error shown).
3. Type "hello" in the chat sidebar, hit send.
4. Red error banner: `Thread <uuid> not found` / `Code: agent_run_error_event` / `runtimeErrorCode: INCOMPLETE_STREAM` / `agentId: "default"`.
5. Reproduces after a full `pnpm dev` restart + hard browser refresh (`Ctrl+Shift+R`) — not just stale HMR/client state.

## What's been ruled out

- **Mastra storage was genuinely in-memory** (`src/mastra/agents/index.ts` — `weatherAgent`'s `Memory` used `LibSQLStore({ url: "file::memory:" })`, violating the project's own documented rule that storage must be file-backed — see `.claude/CLAUDE.md` "Storage" bullet and `docs/implementation-plan.md:90`). **Fixed**: now uses the shared file-backed `storage` from `src/mastra/storage.ts`. Necessary fix, confirmed correct, but **not sufficient** — the browser error persists after this fix.
- **`workingMemory.scope`**: tried flipping `weatherAgent` from `scope: "thread"` to `scope: "resource"` to match `Coach`'s pattern. **Reverted** — confirmed via `@mastra/libsql`'s `updateResource()` (keys a single `workingMemory` blob by `resourceId` alone, no per-agent partition) that this would let `weatherAgent`'s `AgentState` (proverbs) and `coachAgent`'s `BudgetStateSchema` clobber each other under the same browser's `resourceId`. Left at the original `scope: "thread"`, which is safe from that collision.
- **Raw HTTP against the route works fine**: direct `curl` calls to `POST /api/copilotkit/agent/default/run` with a fresh, explicit `threadId` complete cleanly through `RUN_FINISHED` every time, with both storage configs, both scope configs, before and after restart. The backend route, the AG-UI bridge, and Mastra's agent/memory layer are not the problem in isolation.
- **Not a stale in-memory `InMemoryAgentRunner` thread** (first theory): a full `pnpm dev` restart clears that process-lifetime state, but the bug reproduced identically afterward.
- **`GET /api/copilotkit/agent/default/threads` itself responds fast and correctly** (not hanging) — it returns whatever thread(s) the runner currently knows about. Notably, a *brand-new* cookie jar with no prior requests still saw a thread from a previous session/browser — `InMemoryAgentRunner`'s thread bookkeeping does not appear to be scoped per caller/`resourceId` at all (separate observation, possibly worth its own follow-up for the multi-user isolation requirement in `CLAUDE.md`, but not chased further here).

## Leading theory (untested against a real browser — needs confirmation)

Traced `useThreads` in `@copilotkit/react-core`'s v2 bundle (`node_modules/@copilotkit/react-core/dist/copilotkit-DnlgZWST.mjs`):

```js
const preConnectLoading = enabled && !!copilotkit.runtimeUrl && !threadEndpointsUnavailable && !hasDispatchedContext;
...
useEffect(() => {
  ...
  if (runtimeStatus !== CopilotKitCoreRuntimeConnectionStatus.Connected) return; // bails out, never sets hasDispatchedContext
  ...
  setHasDispatchedContext(true);
}, [...]);
```

`isLoading` (which drives "Loading threads…") stays `true` forever unless `hasDispatchedContext` flips to `true`, which requires `copilotkit.runtimeConnectionStatus === "Connected"`. If that status never reaches `"Connected"` in the browser, the thread list — and, plausibly, whatever the chat run path depends on the same connection-status gate for — never initializes correctly, which would produce exactly this class of symptom (stuck loading + runs against threads the server never properly tracked).

There's a pre-existing comment in `src/app/layout.tsx` that already flags a related race:

```tsx
{/* Force REST transport so runtime-info + threads both hit the multi-route endpoint
   (auto-detect races the lazily-compiled API route in next dev). */}
<CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
```

Tested the "cold compile race" angle by asking for a second page reload (after the API route is already warm) — **did not fix it**, so the simple race theory is likely wrong or incomplete. The `runtimeConnectionStatus` stall (if that is in fact what's happening) has some other cause that hasn't been isolated yet — needs actual browser-side debugging (React DevTools / breakpoints on `CopilotKitCoreReact`'s connection status transitions, or a proxy/HAR capture of what the browser's `/info` and thread-list requests actually do differently from the raw `curl` calls that succeed).

## Suspicious but unconfirmed: `.env` Intelligence variables without a license token

`.env` sets:
```
INTELLIGENCE_API_URL=https://api.intelligence.copilotkit.ai
INTELLIGENCE_GATEWAY_WS_URL=wss://realtime.intelligence.copilotkit.ai
SL_ENABLED=true
```
with no `COPILOTKIT_LICENSE_TOKEN`. Server-side (`route.ts`), the `Intelligence` block is correctly gated behind `COPILOTKIT_LICENSE_TOKEN` and falls back to `InMemoryAgentRunner()` when absent — that part looks fine. Not yet confirmed whether the **client-side** `CopilotKit` provider in `layout.tsx` (which doesn't pass any intelligence config, just `runtimeUrl` + `useSingleEndpoint={false}`) does anything with these env vars, or whether `CopilotThreadsDrawer` being license-gated (per the existing comment in `src/app/page.tsx`: *"License-gated: the locked view's Upgrade CTA opens the Intelligence docs by default"*) degrades into this broken-loading state instead of showing the expected "Upgrade" CTA when no token is present. Worth checking whether `CopilotThreadsDrawer` without a license is supposed to show a locked/upgrade view rather than spin forever — if so, this may be a version/config mismatch rather than a wiring bug in this repo.

## Suggested next steps for whoever picks this up

1. Reproduce in a real browser with DevTools open; inspect the Network tab for the *actual* sequence of requests `CopilotKit`/`CopilotThreadsDrawer`/`CopilotSidebar` make on load (not just the two endpoints tested here via `curl`) — look for a request that never resolves, 4xx/5xx's, or hangs.
2. Check `copilotkit.runtimeConnectionStatus` directly (React DevTools component state on the `CopilotKitCoreReact` provider, or add a temporary debug log) to confirm/deny the "never reaches Connected" theory.
3. If `CopilotThreadsDrawer` is confirmed license-gated and misbehaving without `COPILOTKIT_LICENSE_TOKEN`, try temporarily removing `<CopilotThreadsDrawer />` from `page.tsx` (note: `CopilotChatConfigurationProvider` must stay **uncontrolled** per `CLAUDE.md` for `"+ New"` to keep working if the drawer comes back) to see if `CopilotSidebar` alone can complete a run without it — isolates whether the drawer is poisoning shared thread state for the whole page.
4. Cross-check against `ag-ui-app` (the known-good sibling reference project) with the same `.env` shape (no license token) to see if it exhibits the same symptom — would confirm this is a starter-template/SDK-version issue rather than something specific to this repo's wiring.

## Current repo state left after this investigation

- `src/mastra/agents/index.ts`: `weatherAgent`'s memory storage fixed to file-backed (kept — correct regardless of this bug).
- `workingMemory.scope` for `weatherAgent` left at its original `"thread"` (not the resource-scope collision risk).
- `src/app/api/transactions/route.ts` (ticket 05) is unaffected by this bug and independently verified via `curl` — see ticket 05.
