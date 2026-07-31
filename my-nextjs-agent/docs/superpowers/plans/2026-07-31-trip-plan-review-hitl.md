# Trip Plan Review (HITL Suspend/Resume) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new, parallel trip-planning path — `tripPlanReviewWorkflow` — that drafts an itinerary via the existing `tripPlannerAgent`, then pauses (Mastra `suspend`/`resume`) until a human approves, requests changes, or discards it, before anything is persisted. The existing instant `/api/trip-plan` + `PlanTripButton` flow is untouched.

**Architecture:** One new Mastra workflow with a `draft-itinerary` → `review-gate` loop (nested workflow used as a `.dowhile()` loop body) wrapping `tripPlannerAgent`, followed by a `finalize` step that persists on approval. Two new API routes drive it with real token streaming via `run.stream()`/`run.resumeStream()` (not `run.start()`/`run.resume()`, which only resolve once the whole run settles). A new `trip-plan-review.tsx` component renders the draft with Approve/Request changes/Discard controls, wired in next to the existing `PlanTripButton`.

**Tech Stack:** Mastra (`@mastra/core` `createStep`/`createWorkflow`, `dowhile`, suspend/resume, `run.stream()`/`run.resumeStream()`), Vercel AI SDK v5 (`ai` package streaming primitives, same as `/api/trip-plan`), Next.js App Router route handlers, React/shadcn UI (`Button`, `Input`, `Textarea`).

**No test runner is configured in this project** (confirmed in `.claude/CLAUDE.md`), so this plan replaces automated red/green test steps with `pnpm lint` after each code change, a one-off `tsx` smoke-test script to exercise the workflow's suspend/resume mechanics directly (Task 3), and manual in-browser verification at the end — the same verification style the existing trip-planner-agent feature (`docs/superpowers/plans/2026-07-31-trip-planner-agent.md`) was built and shipped with.

**Per explicit user instruction: no `git commit` steps are included anywhere in this plan.** Do not commit as part of executing it. Leave changes staged/unstaged for the user to commit themselves.

## Deviation from the approved spec

The spec (`docs/superpowers/specs/2026-07-31-trip-plan-review-hitl-design.md`, Backend §4) hardcodes the resume `step` target as the path `['draft-and-review', 'review-gate']`, with an explicit note to "double-check the actual shape ... before hardcoding this path."

This plan resolves that hedge instead of hardcoding it: `@mastra/core`'s `WorkflowResult` type (checked in `node_modules/@mastra/core/dist/workflows/types.d.ts`) exposes `suspended: [string[], ...string[][]]` on a `status: 'suspended'` result — the actual, engine-reported path(s) of whichever step(s) are currently suspended. Both new routes (Tasks 5 and 6) read `result.suspended[0]` from the just-completed `run.stream()`/`run.resumeStream()` call and pass that straight back into the next `resumeStream({ step: ... })` call, rather than assuming a fixed literal. This is strictly more robust than the spec's hardcoded guess and requires no behavior change if Mastra's internal nesting path ever differs from what the spec assumed.

**Post-implementation correction (discovered during `pnpm build`):** `mastra.getWorkflowById('trip-plan-review-workflow')` (used throughout Tasks 3-5 below) type-checks to a *union* across every registered workflow, not just `tripPlanReviewWorkflow` — `Mastra`'s `getWorkflowById<TWorkflowName extends keyof TWorkflows>(id: TWorkflows[TWorkflowName]['id'])` overload can't uniquely narrow `TWorkflowName` from a string-literal `id` argument alone (each workflow's `id` field isn't preserved as a distinct literal in a way the overload can discriminate against), so TypeScript infers `run` as a union that also includes `weatherWorkflow`'s `Run` type — which lacks `getWorkflowState()`, breaking Task 5's build. The fix actually applied: use `mastra.getWorkflow('tripPlanReviewWorkflow')` (the registry *key* from `workflows: { weatherWorkflow, tripPlanReviewWorkflow }` in `src/mastra/index.ts`, via `getWorkflow<TWorkflowId extends keyof TWorkflows>(id: TWorkflowId)`) instead — this is also what the existing codebase's own precedent already does (`mastra.getWorkflow('weatherWorkflow')` in `src/app/api/activities/route.ts`), so this plan's `getWorkflowById` calls were the actual deviation from house style, not the other way around. All three occurrences below (Tasks 3, 4, 5) have been corrected to `getWorkflow('tripPlanReviewWorkflow')`.

---

### Task 1: Create the `trip-plan-review-workflow`

**Files:**
- Create: `src/mastra/workflows/trip-plan-review-workflow.ts`

- [ ] **Step 1: Write the workflow**

Create `src/mastra/workflows/trip-plan-review-workflow.ts`:

```ts
import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'
import { tripPlannerAgent } from '../agents/trip-planner-agent'
import { RESOURCE_ID } from '../constants'

const loopSchema = z.object({
  city: z.string(),
  days: z.number(),
  threadId: z.string(),
  itinerary: z.string().optional(),
  decision: z.enum(['approve', 'revise', 'discard']).optional(),
  feedback: z.string().optional(),
})

const draftItinerary = createStep({
  id: 'draft-itinerary',
  description: 'Drafts (or redrafts, given feedback) a trip itinerary for human review',
  inputSchema: loopSchema,
  outputSchema: loopSchema,
  execute: async ({ inputData, writer }) => {
    const { city, days, threadId, feedback } = inputData

    let prompt = `Plan a ${days}-day trip to ${city}.`
    if (feedback) {
      prompt += ` Revise the previous itinerary based on this feedback: ${feedback}`
    }

    const response = await tripPlannerAgent.stream([{ role: 'user', content: prompt }])

    let itinerary = ''
    for await (const chunk of response.textStream) {
      itinerary += chunk
      await writer.write({ type: 'text-delta', text: chunk })
    }

    return { city, days, threadId, itinerary, decision: undefined, feedback: undefined }
  },
})

const reviewGate = createStep({
  id: 'review-gate',
  description: 'Suspends the workflow until a human approves, requests changes, or discards the draft',
  inputSchema: loopSchema,
  outputSchema: loopSchema,
  suspendSchema: z.object({ itinerary: z.string() }),
  resumeSchema: z.object({
    decision: z.enum(['approve', 'revise', 'discard']),
    feedback: z.string().optional(),
  }),
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) {
      return suspend({ itinerary: inputData.itinerary ?? '' })
    }

    return { ...inputData, ...resumeData }
  },
})

const draftAndReview = createWorkflow({
  id: 'draft-and-review',
  inputSchema: loopSchema,
  outputSchema: loopSchema,
})
  .then(draftItinerary)
  .then(reviewGate)

draftAndReview.commit()

const finalize = createStep({
  id: 'finalize',
  description: 'Persists the itinerary to thread memory if approved, discards it otherwise',
  inputSchema: loopSchema,
  outputSchema: z.object({
    itinerary: z.string(),
    status: z.enum(['saved', 'discarded']),
  }),
  execute: async ({ inputData, mastra }) => {
    const { itinerary, decision, threadId } = inputData

    if (decision === 'approve' && itinerary) {
      const memory = await mastra.getAgentById('weather-agent').getMemory()
      if (memory) {
        await memory.saveMessages({
          messages: [
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              createdAt: new Date(),
              threadId,
              resourceId: RESOURCE_ID,
              content: {
                format: 2,
                parts: [{ type: 'text', text: itinerary }],
              },
            },
          ],
        })
      }
      return { itinerary, status: 'saved' as const }
    }

    return { itinerary: itinerary ?? '', status: 'discarded' as const }
  },
})

export const tripPlanReviewWorkflow = createWorkflow({
  id: 'trip-plan-review-workflow',
  inputSchema: z.object({
    city: z.string().describe('The city to plan a trip to'),
    days: z.number().describe('Number of days in the itinerary'),
    threadId: z.string().describe('Chat thread to persist the approved itinerary to'),
  }),
  outputSchema: z.object({
    itinerary: z.string(),
    status: z.enum(['saved', 'discarded']),
  }),
})
  .dowhile(draftAndReview, async ({ inputData }) => inputData.decision === 'revise')
  .then(finalize)

tripPlanReviewWorkflow.commit()
```

`draft-itinerary` and `review-gate` both use `loopSchema` for input and output because `.dowhile()`'s loop-body output is fed straight back in as the next iteration's input — they must match. `draft-itinerary` clears `decision`/`feedback` on every draft so `review-gate` always starts from an undecided state; `review-gate` returns `suspend(...)` directly (not `await suspend(...)` then falling through) when there's no `resumeData` yet, and merges `resumeData` into the carried-forward state once resumed. `draft-and-review` is a separate, committed nested workflow (not a bare `.then()` chain) because `.dowhile()` requires a single `Step`, and a committed `Workflow` satisfies that interface.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors.

---

### Task 2: Register `tripPlanReviewWorkflow` in the Mastra instance

**Files:**
- Modify: `src/mastra/index.ts`

- [ ] **Step 1: Import and register the workflow**

In `src/mastra/index.ts`, add the import near the existing `weatherWorkflow` import:

```ts
import { weatherWorkflow } from './workflows/weather-workflow';
import { tripPlanReviewWorkflow } from './workflows/trip-plan-review-workflow';
```

And update the `workflows` field of the `new Mastra({...})` call:

```ts
    workflows: { weatherWorkflow, tripPlanReviewWorkflow },
```

(it currently reads `workflows: { weatherWorkflow },`).

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors.

---

### Task 3: Smoke-test the workflow's suspend/resume mechanics directly

This is the riskiest, least-precedented part of the feature (no prior suspend/resume usage anywhere in this codebase) — verify it works in isolation, against the real `mastra` instance and a real Ollama call, before building any API routes or UI on top of it. This also discovers the exact shape of `workflow-step-output` stream events so Tasks 5/6 can relay them correctly.

**Files:**
- Create (temporary, not part of the app): `scripts/smoke-test-trip-plan-review.ts`

- [ ] **Step 1: Write the smoke-test script**

Create `scripts/smoke-test-trip-plan-review.ts`:

```ts
import { mastra } from '../src/mastra'

async function main() {
  const workflow = mastra.getWorkflow('tripPlanReviewWorkflow')

  // --- Start ---
  // Each stage below rebuilds the Run from just a runId via a fresh
  // `workflow.createRun({ runId })` call, deliberately discarding the
  // in-memory `run`/`run2` objects from the previous stage first. This
  // mirrors what the real /api/trip-plan-review/resume route does (Task 5):
  // it's a stateless Next.js request handler with no access to any
  // in-process Run object from the start request — it can only rehydrate
  // suspended state from storage via a bare runId. If Mastra's LibSQLStore
  // rehydration doesn't actually work this way, this script (not just the
  // real route, later) is what should fail first.
  let run = await workflow.createRun()
  const runId = run.runId
  const startOutput = run.stream({
    inputData: { city: 'Lisbon', days: 2, threadId: 'smoke-test-thread' },
  })

  for await (const event of startOutput.fullStream) {
    console.log('[start event]', JSON.stringify(event).slice(0, 300))
  }

  const startResult = await startOutput.result
  console.log('\n[start result]', JSON.stringify(startResult, null, 2).slice(0, 2000))

  if (startResult.status !== 'suspended') {
    throw new Error(`Expected 'suspended', got '${startResult.status}'`)
  }

  const suspendedPath = startResult.suspended[0]
  console.log('\n[suspended path]', suspendedPath)

  // Discard the original `run` reference and rebuild from just the runId,
  // simulating a fresh HTTP request hitting the resume route.
  run = await workflow.createRun({ runId })

  // --- Resume: request changes ---
  const reviseOutput = run.resumeStream({
    step: suspendedPath,
    resumeData: { decision: 'revise', feedback: 'Make it more budget-friendly.' },
  })

  for await (const event of reviseOutput.fullStream) {
    console.log('[revise event]', JSON.stringify(event).slice(0, 300))
  }

  const reviseResult = await reviseOutput.result
  console.log('\n[revise result status]', reviseResult.status)
  if (reviseResult.status !== 'suspended') {
    throw new Error(`Expected 'suspended' after revise, got '${reviseResult.status}'`)
  }

  // Rebuild from the runId again before approving, same reasoning as above.
  run = await workflow.createRun({ runId })

  // --- Resume: approve ---
  const approveOutput = run.resumeStream({
    step: reviseResult.suspended[0],
    resumeData: { decision: 'approve' },
  })

  const approveResult = await approveOutput.result
  console.log('\n[approve result]', JSON.stringify(approveResult, null, 2).slice(0, 1000))
  if (approveResult.status !== 'success') {
    throw new Error(`Expected 'success' after approve, got '${approveResult.status}'`)
  }

  // --- Verify persistence ---
  const memory = await mastra.getAgentById('weather-agent').getMemory()
  const recalled = await memory?.recall({ threadId: 'smoke-test-thread', resourceId: 'weather-chat' })
  console.log('\n[persisted messages]', recalled?.messages.length)

  // --- Discard path (separate run) ---
  let run2 = await workflow.createRun()
  const runId2 = run2.runId
  const start2 = run2.stream({ inputData: { city: 'Porto', days: 1, threadId: 'smoke-test-thread-2' } })
  const start2Result = await start2.result
  if (start2Result.status !== 'suspended') {
    throw new Error(`Expected 'suspended' for discard-path run, got '${start2Result.status}'`)
  }
  run2 = await workflow.createRun({ runId: runId2 })
  const discard = run2.resumeStream({
    step: start2Result.suspended[0],
    resumeData: { decision: 'discard' },
  })
  const discardResult = await discard.result
  console.log('\n[discard result]', JSON.stringify(discardResult, null, 2).slice(0, 500))
  if (discardResult.status !== 'success' || discardResult.result.status !== 'discarded') {
    throw new Error(`Expected discarded status, got: ${JSON.stringify(discardResult)}`)
  }

  console.log('\nAll smoke-test assertions passed.')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Step 2: Run it**

Ensure a local Ollama server is running with `llama3.1` pulled, then run:

```bash
npx tsx scripts/smoke-test-trip-plan-review.ts
```

Expected: the script prints a stream of `[start event]`/`[revise event]` lines, a `[start result]` with `"status": "suspended"`, a `[suspended path]` array, a `[revise result status] suspended`, an `[approve result]` with `"status": "success"` whose nested `result.status` is `"saved"`, `[persisted messages] 1` (or more, if a prior run left messages), a `[discard result]` with nested `status: "discarded"`, and finally `All smoke-test assertions passed.`

- [ ] **Step 3: Reconcile the plan's assumptions against real output**

Read the printed `[start event]`/`[revise event]` lines. Confirm a `workflow-step-output` event appears whose payload wraps the `{ type: 'text-delta', text: ... }` chunks written by `draft-itinerary`'s `writer.write(...)` calls (Task 1) — note the exact field path (e.g. `event.payload.output.text` vs. `event.payload.output.payload.text`) and the step id it's tagged with. This exact shape is needed verbatim in Tasks 5 and 6's route code below; if it differs from what those tasks assume, adjust the event-filtering logic there accordingly before moving on. Also confirm `[suspended path]` printed a real array (e.g. `["draft-and-review", "review-gate"]`) — this validates the "Deviation from the approved spec" section above.

- [ ] **Step 4: Delete the smoke-test script**

```bash
rm scripts/smoke-test-trip-plan-review.ts
```

It served its purpose (validating the workflow works and discovering event shapes); it's not part of the shipped app and there's no test runner to keep it registered against.

---

### Task 4: Create the `/api/trip-plan-review` route (start)

**Files:**
- Create: `src/app/api/trip-plan-review/route.ts`

- [ ] **Step 1: Write the route**

Create `src/app/api/trip-plan-review/route.ts`. The event-filtering logic in the `for await` loop below uses the shape discovered in Task 3 Step 3 — adjust the `event.type === 'workflow-step-output'` branch's field access to match exactly what was observed:

```ts
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { mastra } from '@/mastra'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const body = (await req.json()) as { city?: string; days?: number; threadId?: string }
  const { city, days, threadId } = body

  if (!city || !days || !threadId) {
    return NextResponse.json({ error: 'city, days, and threadId are required' }, { status: 400 })
  }

  const messageId = crypto.randomUUID()

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const workflow = mastra.getWorkflow('tripPlanReviewWorkflow')
      const run = await workflow.createRun()
      const runOutput = run.stream({ inputData: { city, days, threadId } })

      writer.write({ type: 'start', messageId })
      writer.write({ type: 'text-start', id: messageId })

      for await (const event of runOutput.fullStream) {
        if (event.type === 'workflow-step-output' && event.payload.output?.type === 'text-delta') {
          writer.write({ type: 'text-delta', id: messageId, delta: event.payload.output.text })
        }
      }

      writer.write({ type: 'text-end', id: messageId })

      const result = await runOutput.result
      if (result.status !== 'suspended') {
        throw new Error(`Expected trip-plan-review workflow to suspend for approval, got status: ${result.status}`)
      }

      writer.write({
        type: 'message-metadata',
        messageMetadata: { runId: run.runId, status: 'suspended' },
      })
      writer.write({ type: 'finish' })
    },
  })

  return createUIMessageStreamResponse({ stream })
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Verify with a direct curl smoke test**

With `pnpm dev` running (and Ollama up) in one terminal, in another:

```bash
curl -s -N -X POST http://localhost:3000/api/trip-plan-review \
  -H "Content-Type: application/json" \
  -d '{"city":"Lisbon","days":2,"threadId":"curl-smoke-test"}'
```

Expected: a stream of SSE-style JSON chunks whose accumulated text-deltas read as a 2-day itinerary (starting each day with `🧳 Day`, per `tripPlannerAgent`'s instructions), ending in a `finish` event whose message metadata carries a `runId` and `"status":"suspended"`. Note the `runId` value — it's needed for Task 5's curl test. Stop the dev server after this check.

---

### Task 5: Create the `/api/trip-plan-review/resume` route

**Files:**
- Create: `src/app/api/trip-plan-review/resume/route.ts`

- [ ] **Step 1: Write the route**

Create `src/app/api/trip-plan-review/resume/route.ts`:

```ts
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { mastra } from '@/mastra'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const body = (await req.json()) as {
    runId?: string
    decision?: 'approve' | 'revise' | 'discard'
    feedback?: string
  }
  const { runId, decision, feedback } = body

  if (!runId || !decision) {
    return NextResponse.json({ error: 'runId and decision are required' }, { status: 400 })
  }

  const workflow = mastra.getWorkflow('tripPlanReviewWorkflow')

  let run
  try {
    run = await workflow.createRun({ runId })
  } catch {
    return NextResponse.json({ error: 'Review session not found or expired' }, { status: 404 })
  }

  const snapshot = await run.getWorkflowState()
  const suspendedPath = snapshot.status === 'suspended' ? snapshot.suspended[0] : undefined

  if (!suspendedPath) {
    return NextResponse.json({ error: 'Review session not found or expired' }, { status: 404 })
  }

  if (decision !== 'revise') {
    // Approve/discard: no further drafting happens, so no need to stream —
    // resolve the run and return the final result directly.
    const result = await run.resume({ step: suspendedPath, resumeData: { decision, feedback } })
    if (result.status !== 'success') {
      return NextResponse.json({ error: `Unexpected workflow status: ${result.status}` }, { status: 500 })
    }
    return NextResponse.json(result.result)
  }

  // Revise: stream the newly-drafted itinerary the same way the start route does.
  const messageId = crypto.randomUUID()

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const runOutput = run.resumeStream({ step: suspendedPath, resumeData: { decision, feedback } })

      writer.write({ type: 'start', messageId })
      writer.write({ type: 'text-start', id: messageId })

      for await (const event of runOutput.fullStream) {
        if (event.type === 'workflow-step-output' && event.payload.output?.type === 'text-delta') {
          writer.write({ type: 'text-delta', id: messageId, delta: event.payload.output.text })
        }
      }

      writer.write({ type: 'text-end', id: messageId })

      const result = await runOutput.result
      if (result.status !== 'suspended') {
        throw new Error(`Expected trip-plan-review workflow to suspend again after revise, got status: ${result.status}`)
      }

      writer.write({
        type: 'message-metadata',
        messageMetadata: { runId: run.runId, status: 'suspended' },
      })
      writer.write({ type: 'finish' })
    },
  })

  return createUIMessageStreamResponse({ stream })
}
```

`run.getWorkflowState()` (confirmed as a real method on `Run` in `node_modules/@mastra/core/dist/workflows/workflow.d.ts`) reads the current persisted state — including the `suspended` path array — for a `Run` rehydrated from just a `runId`, which is exactly what Task 3 Step 3's fresh-`createRun({ runId })` smoke test exercises before this route is written.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Verify with a curl chain**

With `pnpm dev` running, using the `runId` captured from Task 4 Step 3:

```bash
curl -s -N -X POST http://localhost:3000/api/trip-plan-review/resume \
  -H "Content-Type: application/json" \
  -d '{"runId":"<runId from Task 4>","decision":"revise","feedback":"Make it more budget-friendly."}'
```

Expected: a new streamed draft, ending in `finish` with a fresh `runId`/`"status":"suspended"` (may be the same `runId`, since it's the same underlying run). Then approve it:

```bash
curl -s -X POST http://localhost:3000/api/trip-plan-review/resume \
  -H "Content-Type: application/json" \
  -d '{"runId":"<runId from the revise response>","decision":"approve"}'
```

Expected: a plain JSON response `{"itinerary": "...", "status": "saved"}`. Then start a fresh run via Task 4's curl command and discard it instead of approving — expect `{"status": "discarded"}` with no `itinerary` change to the thread's persisted messages. Finally, try resuming a bogus `runId`:

```bash
curl -s -X POST http://localhost:3000/api/trip-plan-review/resume \
  -H "Content-Type: application/json" \
  -d '{"runId":"not-a-real-run","decision":"approve"}'
```

Expected: HTTP 404 with `{"error":"Review session not found or expired"}`. Stop the dev server after this check.

---

### Task 6: Create `src/components/trip-plan-review.tsx`

**Files:**
- Create: `src/components/trip-plan-review.tsx`

- [ ] **Step 1: Write the component module**

Create `src/components/trip-plan-review.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema, type UIMessage, type UIMessageChunk } from 'ai'
import { Loader2Icon, MapIcon, CheckIcon, XIcon, PencilIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { MessageResponse } from '@/components/ai-elements/message'
import { type TripPlanMetadata } from '@/components/trip-plan'

type ReviewStatus = 'idle' | 'selecting' | 'drafting' | 'suspended' | 'revising' | 'submitting' | 'discarded' | 'expired' | 'error'

async function consumeUiMessageStream(res: Response, onDelta: (text: string) => void): Promise<UIMessage> {
  if (!res.ok || !res.body) {
    throw new Error('Trip plan review request failed')
  }

  const chunkStream = parseJsonEventStream({
    stream: res.body,
    schema: uiMessageChunkSchema,
  }).pipeThrough(
    new TransformStream<{ success: boolean; value?: UIMessageChunk; error?: unknown }, UIMessageChunk>({
      transform(chunk, controller) {
        if (!chunk.success || !chunk.value) {
          controller.error(chunk.error ?? new Error('Invalid trip plan review stream chunk'))
          return
        }
        controller.enqueue(chunk.value)
      },
    })
  )

  let last: UIMessage | undefined
  for await (const message of readUIMessageStream({ stream: chunkStream })) {
    last = message
    const text = message.parts
      ?.filter(part => part.type === 'text')
      .map(part => (part as { text: string }).text)
      .join('') ?? ''
    onDelta(text)
  }

  if (!last) {
    throw new Error('Trip plan review stream ended with no message')
  }
  return last
}

export function TripPlanReviewCard({
  itinerary,
  status,
  feedback,
  disabled,
  onApprove,
  onStartRevising,
  onRequestChanges,
  onDiscard,
  onStartOver,
}: {
  itinerary: string
  status: ReviewStatus
  feedback: string
  disabled?: boolean
  onApprove: () => void
  onStartRevising: () => void
  onRequestChanges: (feedback: string) => void
  onDiscard: () => void
  onStartOver: () => void
}) {
  const [feedbackDraft, setFeedbackDraft] = useState('')
  const controlsDisabled = disabled || status === 'submitting' || status === 'drafting'

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wide">
        <MapIcon className="size-3.5" />
        Trip Itinerary {status === 'suspended' || status === 'revising' ? '(draft — awaiting review)' : ''}
        {status === 'discarded' ? '(discarded)' : ''}
      </div>
      <MessageResponse>{itinerary}</MessageResponse>

      {status === 'expired' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          This review session expired —{' '}
          <Button size="sm" variant="outline" onClick={onStartOver}>
            start again
          </Button>
        </div>
      )}

      {(status === 'suspended' || status === 'revising' || status === 'submitting') && status !== 'expired' && (
        <div className="space-y-2 pt-1">
          {status === 'revising' ? (
            <div className="flex items-center gap-2">
              <Textarea
                value={feedbackDraft}
                disabled={controlsDisabled}
                onChange={e => setFeedbackDraft(e.target.value)}
                placeholder="What should change?"
                className="min-h-16"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={controlsDisabled || !feedbackDraft.trim()}
                onClick={() => onRequestChanges(feedbackDraft)}
              >
                {status === 'submitting' ? <Loader2Icon className="size-3.5 animate-spin" /> : 'Send'}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" disabled={controlsDisabled} onClick={onApprove}>
                {status === 'submitting' ? <Loader2Icon className="size-3.5 animate-spin" /> : <CheckIcon className="size-3.5" />}
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={controlsDisabled}
                onClick={() => {
                  setFeedbackDraft(feedback)
                  onStartRevising()
                }}
              >
                <PencilIcon className="size-3.5" />
                Request changes
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" disabled={controlsDisabled} onClick={onDiscard}>
                <XIcon className="size-3.5" />
                Discard
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function TripPlanReviewButton({
  city,
  threadId,
  disabled,
  onMessage,
}: {
  city: string
  threadId: string
  disabled?: boolean
  onMessage: (message: UIMessage) => void
}) {
  const [status, setStatus] = useState<ReviewStatus>('idle')
  const [days, setDays] = useState(3)
  const [runId, setRunId] = useState<string | null>(null)
  const [itinerary, setItinerary] = useState('')
  const [feedback, setFeedback] = useState('')

  const startDraft = async () => {
    if (disabled) return
    setStatus('drafting')
    setItinerary('')

    try {
      const res = await fetch('/api/trip-plan-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city, days, threadId }),
      })

      const message = await consumeUiMessageStream(res, setItinerary)
      const metadata = message.metadata as { runId?: string; status?: string } | undefined
      if (!metadata?.runId) throw new Error('Missing runId in trip plan review response')

      setRunId(metadata.runId)
      setStatus('suspended')
    } catch (error) {
      console.error('Failed to draft trip plan for review', error)
      setStatus('error')
    }
  }

  const resume = async (decision: 'approve' | 'revise' | 'discard', feedbackText?: string) => {
    if (!runId || disabled) return
    // 'revise' re-enters the streaming draft path (new itinerary text arrives
    // token-by-token), so it reuses 'drafting' — the same status the initial
    // draft uses to hide all review controls while text streams in. 'approve'/
    // 'discard' don't stream anything back, so they use 'submitting' instead,
    // which keeps the current draft + controls visible with a spinner.
    setStatus(decision === 'revise' ? 'drafting' : 'submitting')

    try {
      const res = await fetch('/api/trip-plan-review/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, decision, feedback: feedbackText }),
      })

      if (res.status === 404) {
        setStatus('expired')
        return
      }

      const contentType = res.headers.get('content-type') ?? ''

      if (decision === 'revise') {
        const message = await consumeUiMessageStream(res, setItinerary)
        const metadata = message.metadata as { runId?: string; status?: string } | undefined
        setRunId(metadata?.runId ?? runId)
        setStatus('suspended')
        return
      }

      if (!res.ok) throw new Error('Trip plan review resume failed')

      if (contentType.includes('application/json')) {
        const result = (await res.json()) as { itinerary?: string; status: 'saved' | 'discarded' }
        if (result.status === 'saved' && result.itinerary) {
          setItinerary(result.itinerary)
          onMessage({
            id: crypto.randomUUID(),
            role: 'assistant',
            parts: [{ type: 'text', text: result.itinerary }],
            metadata: { kind: 'trip-plan' } as TripPlanMetadata,
          })
          setStatus('idle')
          setRunId(null)
        } else {
          setStatus('discarded')
        }
      }
    } catch (error) {
      console.error('Failed to resume trip plan review', error)
      setStatus('error')
    }
  }

  const startOver = () => {
    setStatus('idle')
    setRunId(null)
    setItinerary('')
    setFeedback('')
  }

  if (status === 'suspended' || status === 'revising' || status === 'submitting' || status === 'drafting' || status === 'discarded' || status === 'expired') {
    return (
      <TripPlanReviewCard
        itinerary={itinerary}
        status={status}
        feedback={feedback}
        disabled={disabled}
        onApprove={() => resume('approve')}
        onStartRevising={() => setStatus('revising')}
        onRequestChanges={text => {
          setFeedback(text)
          void resume('revise', text)
        }}
        onDiscard={() => resume('discard')}
        onStartOver={startOver}
      />
    )
  }

  if (status === 'idle' || status === 'error') {
    return (
      <Button size="sm" variant="outline" className="gap-1.5" disabled={disabled} onClick={() => setStatus('selecting')}>
        <MapIcon className="size-3.5" />
        {status === 'error' ? 'Try again' : 'Plan my trip (with review)'}
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={1}
        max={7}
        value={days}
        disabled={disabled}
        onChange={e => setDays(Math.min(7, Math.max(1, Number(e.target.value) || 1)))}
        className="w-16"
      />
      <span className="text-muted-foreground text-xs">days</span>
      <Button size="sm" variant="outline" disabled={disabled} onClick={startDraft}>
        Go
      </Button>
    </div>
  )
}
```

Notes on this implementation vs. the spec's literal wording:
- The "Request changes" button first flips `status` to `'revising'` (via `onStartRevising`), which reveals the feedback `Textarea` + "Send" button inside the same card; clicking "Send" calls `onRequestChanges(feedbackDraft)`, which submits and resumes the workflow — a two-click reveal-then-send flow, matching the spec's description.
- On approve, the finalized itinerary is injected into the main chat via `onMessage` (reusing `TripPlanMetadata`/`isTripPlanMessage` from `trip-plan.tsx` so it renders through the existing `TripPlanCard`) — this satisfies the spec's "Card converts to a finalized look (same as `TripPlanCard`)" by literally becoming a `TripPlanCard`-rendered message, rather than duplicating that visual treatment in a second component.
- `guarding-streaming-ui-actions`: the outer entry button and every control inside `TripPlanReviewCard` respect the `disabled` prop (threaded from the chat's `status !== 'ready'`, same as `PlanTripButton`), and each `resume(...)`/`startDraft()` handler early-returns when `disabled` is true.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors. (Component isn't rendered anywhere yet — end-to-end behavior is verified in Task 8.)

---

### Task 7: Wire `TripPlanReviewButton` into `chat/page.tsx`

**Files:**
- Modify: `src/app/chat/page.tsx`

- [ ] **Step 1: Import the new component**

In `src/app/chat/page.tsx`, add to the imports (near the existing `PlanTripButton` import):

```tsx
import { PlanTripButton } from '@/components/trip-plan'
import { TripPlanReviewButton } from '@/components/trip-plan-review'
```

- [ ] **Step 2: Render it alongside `PlanTripButton`**

Inside the `ActivityPlanCard`'s children block (where `PlanTripButton` is currently rendered), add `TripPlanReviewButton` right after it, passing the same props:

```tsx
                    <ActivityPlanCard message={message}>
                      {activityPlanCity && (
                        <div className="flex flex-wrap items-center gap-2">
                          <PlanTripButton
                            city={activityPlanCity}
                            threadId={threadId}
                            disabled={status !== 'ready'}
                            onMessage={newMessage =>
                              setMessages(prev => [...prev.filter(m => m.id !== newMessage.id), newMessage])
                            }
                          />
                          <TripPlanReviewButton
                            city={activityPlanCity}
                            threadId={threadId}
                            disabled={status !== 'ready'}
                            onMessage={newMessage =>
                              setMessages(prev => [...prev.filter(m => m.id !== newMessage.id), newMessage])
                            }
                          />
                        </div>
                      )}
                    </ActivityPlanCard>
```

(Wrapping both buttons in a `flex flex-wrap` div keeps them from overlapping when `TripPlanReviewButton` expands into its stepper/card states.)

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no errors.

---

### Task 8: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the app**

Ensure a local Ollama server is running with `llama3.1` pulled, then run `pnpm dev` and open `http://localhost:3000/chat`.

- [ ] **Step 2: Approve path**

1. Ask "What's the weather in Lisbon?", click "Suggest activities", confirm the `ActivityPlanCard` appears with both "Plan my trip" and "Plan my trip (with review)" buttons.
2. Click "Plan my trip (with review)", set days to 2, click "Go".
3. Confirm a draft streams in with Approve / Request changes / Discard controls once it finishes.
4. Click Approve. Confirm the card converts into a normal `TripPlanCard`-style finalized message.
5. Reload the page (same thread). Confirm the approved itinerary is still there, persisted.

- [ ] **Step 3: Revise path**

1. Repeat steps 1-3 of Step 2 above (new draft).
2. Click "Request changes", type feedback (e.g. "make it cheaper"), submit.
3. Confirm a new draft streams in reflecting the feedback, with controls re-enabled.
4. Repeat once more with different feedback, then Approve.
5. Reload the page. Confirm only the final approved itinerary is in the thread — not the intermediate drafts.

- [ ] **Step 4: Discard path**

1. Start a new draft, click Discard.
2. Confirm the card shows a discarded state with no approve/revise/discard controls.
3. Reload the page. Confirm nothing from this draft was persisted to the thread.

- [ ] **Step 5: Expired-run handling**

With the dev server running, manually trigger a 404 by calling resume with a bogus `runId`:

```bash
curl -s -X POST http://localhost:3000/api/trip-plan-review/resume \
  -H "Content-Type: application/json" \
  -d '{"runId":"not-a-real-run","decision":"approve"}'
```

Confirm this returns 404 (already checked in Task 5 Step 3). In the browser, this path is harder to trigger without server restart/expiry; treat Task 5's curl verification as sufficient coverage for this case, and just confirm visually that `onStartOver` (the "start again" button in the expired state) is reachable by temporarily forcing `status` to `'expired'` in React DevTools if available — otherwise skip the live-UI check here, since it was already exercised at the API level.

- [ ] **Step 6: Verify the guard and disabled states**

While a normal chat message is streaming, confirm both "Plan my trip" and "Plan my trip (with review)" are disabled and unclickable until the stream finishes (same as the existing `PlanTripButton` guard).

- [ ] **Step 7: Verify error handling**

Stop the Ollama server, click "Plan my trip (with review)" → pick a day count → "Go". Confirm the button flips to a "Try again" state rather than crashing the page. Restart Ollama afterward.

---

### Task 9: Final build check

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck + production build**

Run: `pnpm build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 2: Final lint pass**

Run: `pnpm lint`
Expected: no errors or warnings across the whole project.
