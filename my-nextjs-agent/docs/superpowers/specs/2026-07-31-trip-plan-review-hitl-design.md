# Trip Plan Review (HITL Suspend/Resume) — Design

## Goal

Add a demo of Mastra's workflow-level human-in-the-loop (HITL) primitive —
`suspend`/`resume` — by building a second, parallel path to trip planning:
instead of the existing `tripPlannerAgent` call finalizing an itinerary
immediately, a new `tripPlanReviewWorkflow` drafts an itinerary, **pauses**,
and waits for a human decision (approve / request changes / discard) before
anything is persisted. This is a learning/demo feature: the app currently has
one registered-but-unwired workflow (`weatherWorkflow`) and no example of
suspend/resume, working memory aside.

The existing `/api/trip-plan` + `PlanTripButton` + `TripPlanCard` flow (an
agent call that streams straight to a finalized, persisted itinerary) is left
completely untouched. This is a new, separate entry point.

## Trigger

A new button, "Plan my trip (with review)", rendered next to the existing
`PlanTripButton` wherever it currently appears (inside `ActivityPlanCard`).
Same day-count stepper UX (1–7, default 3) as `PlanTripButton`. Confirming
starts a review session for that city/day count.

## Architecture

```
User clicks "Plan my trip (with review)" (city, days)
  → POST /api/trip-plan-review { city, days, threadId }
    → tripPlanReviewWorkflow.createRun() → run.start({ inputData: { city, days, threadId } })
      → draft-itinerary step: tripPlannerAgent.stream(...) → itinerary text
      → review-gate step: suspend({ itinerary })
    ← stream draft text + { runId, status: 'suspended' } to client
  → TripPlanReviewCard renders the draft with Approve / Request changes / Discard

User clicks "Request changes" (feedback text)
  → POST /api/trip-plan-review/resume { runId, decision: 'revise', feedback }
    → run.resumeStream({ step: ['draft-and-review', 'review-gate'], resumeData: { decision: 'revise', feedback } })
      → dowhile loop re-enters: draft-itinerary (with feedback) → review-gate → suspend again
  ← stream new draft + { runId, status: 'suspended' }
  → Card updates in place, review controls re-appear

User clicks "Approve"
  → POST /api/trip-plan-review/resume { runId, decision: 'approve' }
    → run.resumeStream({ step: ['draft-and-review', 'review-gate'], resumeData: { decision: 'approve' } })
      → dowhile exits → finalize step persists itinerary to thread memory
  ← { itinerary, status: 'saved' }
  → Card converts to a finalized look (same as TripPlanCard)

User clicks "Discard"
  → POST /api/trip-plan-review/resume { runId, decision: 'discard' }
    → run.resumeStream({ step: ['draft-and-review', 'review-gate'], resumeData: { decision: 'discard' } })
      → dowhile exits → finalize step returns without persisting
  ← { status: 'discarded' }
  → Card shows a "Discarded" state
```

## Backend

1. **`src/mastra/workflows/trip-plan-review-workflow.ts`** — new workflow
   `tripPlanReviewWorkflow`. Every step in the loop shares one carry-through
   schema so the loop body's output shape matches its input shape (a
   `.dowhile()` requirement — its loop-body output is fed back in as the next
   iteration's input):

   ```ts
   const loopSchema = z.object({
     city: z.string(),
     days: z.number(),
     threadId: z.string(),
     itinerary: z.string().optional(),
     decision: z.enum(['approve', 'revise', 'discard']).optional(),
     feedback: z.string().optional(),
   })
   ```

   - **`draft-itinerary`** (`createStep`, id `'draft-itinerary'`)
     - `inputSchema: loopSchema`, `outputSchema: loopSchema`
     - `execute: async ({ inputData, writer }) => ...` — accepts the step
       `writer` (per Mastra's streaming guide) so it can forward tokens live,
       not just return a final string.
     - Calls `tripPlannerAgent.stream(...)` with the same prompt shape
       `/api/trip-plan` uses today (`Plan a {days}-day trip to {city}.`), and
       when `feedback` is present, appends
       `Revise the previous itinerary based on this feedback: {feedback}`.
       As chunks arrive on `.textStream` (same accumulation pattern
       `planActivities` and `askWeatherAgentTool` use), each chunk is both
       accumulated into the full itinerary string and forwarded via
       `writer.write({ type: 'text-delta', ... })` so the route layer (see
       §3/§4 below) can relay it to the client as it's generated.
     - Output: `{ city, days, threadId, itinerary: <accumulated text>, decision: undefined, feedback: undefined }`
       — `decision`/`feedback` are cleared so `review-gate` always sees a
       fresh, undecided draft, and `city`/`days`/`threadId` pass through
       unchanged for any later iteration.

   - **`review-gate`** (`createStep`, id `'review-gate'`)
     - `inputSchema: loopSchema`, `outputSchema: loopSchema`
     - `suspendSchema: z.object({ itinerary: z.string() })` — what the client
       actually needs to render.
     - `resumeSchema: z.object({ decision: z.enum(['approve', 'revise', 'discard']), feedback: z.string().optional() })`
     - On first entry (no `resumeData`): `await suspend({ itinerary: inputData.itinerary })`.
     - On resume: returns `{ ...inputData, ...resumeData }` — `city`/`days`/
       `threadId`/`itinerary` pass through from the input, `decision`/
       `feedback` come from the human's `resumeData`.

   - **`draft-and-review`** — a nested, committed workflow used as the loop
     body (`.dowhile()` takes a single `Step` or a committed `Workflow`, not
     a `.then()`-chained pair of steps):
     ```ts
     const draftAndReview = createWorkflow({
       id: 'draft-and-review',
       inputSchema: loopSchema,
       outputSchema: loopSchema,
     }).then(draftItinerary).then(reviewGate).commit()
     ```

   - Compose the outer workflow:
     ```ts
     createWorkflow({
       id: 'trip-plan-review-workflow',
       inputSchema: z.object({ city: z.string(), days: z.number(), threadId: z.string() }),
       outputSchema: z.object({ itinerary: z.string(), status: z.enum(['saved', 'discarded']) }),
     })
       .dowhile(draftAndReview, ({ inputData }) => inputData.decision === 'revise')
       .then(finalize)
       .commit()
     ```
     Each pass through `draftAndReview` drafts, suspends, and (on resume)
     resolves a decision; the loop repeats while `decision === 'revise'`,
     carrying the accumulating `feedback`/`itinerary` forward each time via
     `loopSchema`, until `decision` is `'approve'` or `'discard'`.

   - **`finalize`** (`createStep`, id `'finalize'`)
     - `inputSchema: loopSchema`, `outputSchema: { itinerary: z.string(), status: z.enum(['saved', 'discarded']) }`
     - If `decision === 'approve'`: persist `itinerary` as an assistant
       message via `mastra.getAgentById('weather-agent').getMemory()`,
       reusing the same `threadId`/`RESOURCE_ID` persistence pattern
       `persistTripPlan` in `/api/trip-plan/route.ts` already uses. Returns
       `status: 'saved'`.
     - If `decision === 'discard'`: no persistence. Returns
       `status: 'discarded'`.

2. Register `tripPlanReviewWorkflow` in `src/mastra/index.ts`'s `workflows`
   map (alongside `weatherWorkflow`).

3. **`src/app/api/trip-plan-review/route.ts`** (`POST`) — accepts
   `{ city, days, threadId }` (400 if any missing, matching existing route
   validation style). Calls
   `mastra.getWorkflowById('trip-plan-review-workflow').createRun()`, then
   `run.stream({ inputData: { city, days, threadId } })` (not `run.start()`
   — `.start()`/`.resume()` only resolve with a final `WorkflowResult` once
   the whole run settles; live token streaming out of `draft-itinerary`
   requires the event-stream variants, per Mastra's streaming guide). The
   route builds a `createUIMessageStream({ execute })` (same shape
   `/api/trip-plan` uses) and, as it consumes `run.stream()`'s event stream,
   relays each `draft-itinerary` text-delta event as a
   `writer.write({ type: 'text-delta', ... })` UI chunk. Once the stream
   reports the run is suspended, writes a final chunk carrying
   `{ runId: run.runId, status: 'suspended' }` via message metadata so the
   client can hold onto the run for the resume step.

4. **`src/app/api/trip-plan-review/resume/route.ts`** (`POST`) — accepts
   `{ runId, decision, feedback?, threadId }`. Looks up the run via
   `mastra.getWorkflowById('trip-plan-review-workflow').createRun({ runId })`
   (Mastra rehydrates suspended run state from the same `LibSQLStore` used
   elsewhere — no separate in-memory run registry needed), then calls
   `run.resumeStream({ step: ['draft-and-review', 'review-gate'], resumeData: { decision, feedback } })`
   — `review-gate` lives inside the nested `draft-and-review` workflow used
   as the `.dowhile()` loop body, so per Mastra's suspend/resume docs the
   `step` targeting a suspended step nested inside a sub-workflow is a path
   array, not a bare string. (Implementation should double-check the actual
   shape of `run.getState()`'s/the stream's suspended-path payload against
   the installed `@mastra/core` version before hardcoding this path, in case
   the exact nesting differs from what's assumed here.)
   - If the resumed run suspends again (revise loop): relay the new draft's
     text-deltas the same way the start route does, again finishing with
     `{ runId, status: 'suspended' }`.
   - If the run has completed (`approve`/`discard`): return
     `{ itinerary, status: 'saved' | 'discarded' }` directly (no streaming
     needed — the itinerary text was already fully drafted before this
     resume call).
   - If `run.resumeStream` fails because `runId` doesn't correspond to a real
     suspended run (expired/invalid): return 404 with a short error body.

## Frontend

- **`src/components/trip-plan-review.tsx`** — new module:
  - `TripPlanReviewButton` — mirrors `PlanTripButton`'s day-count stepper UX,
    but posts to `/api/trip-plan-review` instead, and its `onMessage`-style
    callback creates a `TripPlanReviewCard` (not a finalized `TripPlanCard`)
    holding `{ runId, itinerary, status: 'suspended' }` in local state.
  - `TripPlanReviewCard` — renders the current draft via the same
    `MessageResponse` component `TripPlanCard` uses, plus a control row:
    - **Approve** button
    - **Request changes** button, which reveals a feedback `Textarea` and a
      "Send" action
    - **Discard** button
    Each action posts to `/api/trip-plan-review/resume` with the
    corresponding `decision`. While a request is in flight, controls disable
    and a spinner shows (mirroring `PlanTripButton`'s `loading` state).
    - On `status: 'suspended'` response: update the card's `itinerary` and
      re-enable the review controls.
    - On `status: 'saved'`: swap to the same finalized visual treatment as
      `TripPlanCard` (itinerary text, "Trip Itinerary" header, no controls).
    - On `status: 'discarded'`: show a muted "Discarded" state with the last
      draft still visible for reference, no controls.
    - On a 404 (expired/invalid run): show "This review session expired —
      please start again" with a button that resets the card back to the
      `TripPlanReviewButton`'s initial state.
  - Wiring this button's mutation-triggering flow follows the
    `guarding-streaming-ui-actions` skill's guidance during implementation,
    same as the existing `PlanTripButton`.

- **Wiring into `ActivityPlanCard`**: `TripPlanReviewButton` renders
  alongside the existing `PlanTripButton`, reusing the same `city` prop
  threading already in place for `PlanTripButton` (see the trip-planner-agent
  design doc's "Known limitation" note — this applies here too: after reload,
  restored review cards won't have a `city` to relaunch from, which is
  accepted as-is, matching the existing trip-plan feature's posture).

## Error handling

- **Client**: fetch/stream errors on start or resume are caught and surface
  as an inline error state on the card (does not crash the rest of the chat),
  consistent with `PlanTripButton`'s existing error handling.
- **Server**: errors from `tripPlannerAgent` inside `draftItinerary` (e.g.
  Ollama unreachable) propagate as a stream error, same as `/api/trip-plan`
  today.
- **Stale/invalid `runId`** on resume is treated as an expected, user-facing
  case (session expired), not a crash — 404 with a message, handled by the
  card's UI as described above.

## Testing

No test runner is configured in this project. Verification is manual against
the dev server (`pnpm dev`, requires local Ollama running):
- Approve path: draft → approve → itinerary appears in chat and persists
  across a reload.
- Revise path: draft → request changes (once, then twice) → each new draft
  reflects the feedback → approve → only the final approved itinerary is
  persisted (not the intermediate drafts).
- Discard path: draft → discard → nothing persisted, thread unaffected.
- Expired run: manually resume with a bogus `runId` → card shows the expired
  state and can be reset.

## Out of scope

- No changes to the existing `/api/trip-plan`, `PlanTripButton`, or
  `TripPlanCard` — they remain the instant, non-reviewed path.
- No persistence of intermediate/discarded drafts — only an approved
  itinerary is ever written to memory.
- No cross-session/cross-user run recovery UI beyond the single "expired,
  start again" case — no run history or list of past review sessions.
- No changes to `tripPlannerAgent`'s instructions, tools, or the underlying
  weather/destination-guide lookups it performs — `draftItinerary` calls it
  exactly as `/api/trip-plan` does today, just wrapped in a workflow.
