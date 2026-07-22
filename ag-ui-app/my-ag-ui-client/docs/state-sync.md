# Shared state: schema and how to watch it sync

This project uses AG-UI's built-in shared-state mechanism to keep a "session
dashboard" in sync between the **backend** (the agent's `run()` loop, in
[`src/customAgent.ts`](../src/customAgent.ts)) and the **frontend** (the CLI
chat loop, in [`src/index.ts`](../src/index.ts)). Only exercised when
`AGENT_IMPL=custom` (`CustomStreamingAgent`) — the Mastra-backed agent
(`src/agent.ts`) doesn't participate.

## The model: one object, two owners

Both sides read and write the *same* `SessionState` object
(`src/state/sessionState.ts`), owned by the AG-UI SDK as `agent.state`.
Neither side patches `agent.state` by hand — instead:

- The **backend** mutates it by emitting `STATE_SNAPSHOT` / `STATE_DELTA`
  events from `run()`. The SDK applies these onto `agent.state` for you.
- The **frontend** mutates it by calling `agent.setState(next)` — a full
  local replace that also fires `onStateChanged` for any active subscriber.

```ts
export const SessionStateSchema = z.object({
  messageCount: z.number().default(0),
  weatherLookups: z.array(z.object({ location, summary, at })).default([]),
  calculations: z.array(z.object({ expression, result, at })).default([]),
  openedUrls: z.array(z.string()).default([]),
  lastUpdated: z.string().nullable().default(null),
})
```

| Field            | Mutated by                                | When                                  |
|------------------|--------------------------------------------|----------------------------------------|
| `messageCount`   | backend (`STATE_SNAPSHOT`)                 | top of every run                       |
| `weatherLookups` | backend (`STATE_DELTA`)                    | server-side `get_weather` tool resolves|
| `calculations`   | frontend (`agent.setState`)                | client-side `calculate` tool resolves  |
| `openedUrls`     | frontend (`agent.setState`)                | client-side `openUrl` tool succeeds    |
| `lastUpdated`    | both                                        | any of the above                       |

## The two event types

- **`STATE_SNAPSHOT`** — `{ snapshot }`. A full replace of `agent.state`. Cheap
  to reason about, more expensive on the wire. We emit one at the top of
  every backend run, seeded from `input.state` (what the client sent in) —
  this re-hydrates both sides from one known-good object instead of assuming
  every prior delta landed cleanly.
- **`STATE_DELTA`** — `{ delta }`, an array of RFC 6902 JSON Patch ops (`add`,
  `replace`, ...), applied onto the existing `agent.state`. Cheap to send,
  used for small incremental updates. We emit one whenever the server-side
  weather tool resolves, computed via `fast-json-patch`'s `compare()`
  (wrapped as `diffSessionState`) between the before/after state rather than
  hand-writing ops per call site:

  ```ts
  const delta = diffSessionState(currentState, nextState)
  if (delta.length > 0) {
    emit({ type: EventType.STATE_DELTA, delta })
  }
  ```

## The round-trip

```
frontend (setState)              backend (run())
────────────────────             ─────────────────────────────
agent.setState(next) ──────► prepareRunAgentInput() includes
                              `state: agent.state` as input.state
                                          │
                                          ▼
                              run() reads input.state, emits
                              STATE_SNAPSHOT (bumped messageCount,
                              lastUpdated) ────────────────┐
                              tool resolves → emits         │
                              STATE_DELTA ──────────────────┤
                                          ▼                 ▼
                              SDK applies both onto agent.state
                                          │
                                          ▼
                    onStateChanged(state) fires on the subscriber
                                          │
                                          ▼
                         renderDashboard(state) — frontend renders
```

`agent.setState()` on the client is the mirror image of the backend's
`STATE_SNAPSHOT`/`STATE_DELTA` emits: because `prepareRunAgentInput()` always
sends `state: agent.state` as `input.state`, whatever the frontend just set
locally is exactly what the backend sees at the top of its next run — closing
the loop.

## Watching sync in code

Pass an `AgentSubscriber` as the second argument to `runAgent()`
(`src/index.ts`):

```ts
onStateSnapshotEvent({ event }) {
  console.log("📦 state snapshot received")   // full replace just arrived
},
onStateDeltaEvent({ event }) {
  console.log("🔀 state delta:", event.delta)  // incremental patch just arrived
},
onStateChanged({ state }) {
  renderDashboard(state)                       // state has now settled — render it
},
```

- `onStateSnapshotEvent` / `onStateDeltaEvent` fire on the *raw* event, before
  it's applied — useful for logging/debugging exactly what came over the wire.
- `onStateChanged` fires *after* application (from either event, or from a
  local `setState` call) — this is the one callback to use if all you care
  about is "what does state look like now."

## Try it

```bash
AGENT_IMPL=custom pnpm start
```

1. Ask for weather (e.g. "weather in Hanoi") → watch
   `📦 state snapshot received` → `🔀 state delta: ...` →
   `📊 Session state: { ... weatherLookups updated ... }`.
2. Ask for a calculation (e.g. "what is 12*9") → the dashboard updates
   immediately via the client-side `setState`, and the **next** run's
   snapshot echoes `calculations` straight back — proving the round-trip.
