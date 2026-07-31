# Recommend Activities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Suggest activities" action on weather tool-result cards in the chat UI that runs the existing (currently unused) `weatherWorkflow`, streams the resulting activity plan live into the conversation as a visually distinct card, and persists it to chat memory so it survives reload.

**Architecture:** A new `POST /api/activities` route runs `weatherWorkflow` to completion via its plain (non-streaming) `run.start({ inputData })` API — Mastra's `handleWorkflowStream` helper was tried first but turned out to only emit step-progress `data-workflow` chunks, not `text-*` UIMessageChunk parts, so it's not usable here (see "Design correction" below). Once the workflow finishes and returns the final activity-plan text, the route itself synthesizes a standard `text-start`/`text-delta`/`text-end` UIMessageChunk stream (via `createUIMessageStream`'s `writer`), splitting the text into small chunks with a short delay between each for a live-reveal effect, and separately persists the same text to Mastra memory via `memory.saveMessages()`. The client button does a raw `fetch` (bypassing `useChat`, since this isn't a normal chat turn), decodes the SSE response with AI SDK's own `parseJsonEventStream`/`readUIMessageStream` utilities (the exact mechanism `DefaultChatTransport` uses internally), and appends the resulting message straight into `useChat`'s `messages` state as it streams in.

**Tech Stack:** Next.js App Router route handlers, `@mastra/ai-sdk`/`@mastra/core` (`Mastra.getWorkflow`, `Workflow.createRun`, `Run.start`), `ai` package (`createUIMessageStream`, `createUIMessageStreamResponse`, `parseJsonEventStream`, `uiMessageChunkSchema`, `readUIMessageStream`), existing `weatherWorkflow` (`src/mastra/workflows/weather-workflow.ts`), existing `ai-elements` UI primitives.

**Design correction (found during implementation):** the original plan assumed `handleWorkflowStream` streams the same way `handleChatStream` does for agent chat. It doesn't — for a workflow run, its SSE output only contains `start`/`data-workflow`/`data-workflow-step`/`finish` chunks; the final `plan-activities` step's output text is nested inside the last `data-workflow` chunk's JSON payload (`data.steps['plan-activities'].output.activities`), never emitted as a `text` part. That silently broke both the route's `persistActivityPlan` (its `part.type === 'text'` filter matched nothing, so it early-returned without saving — confirmed via direct `mastra.db` inspection after a manual `curl` test) and the client's text-extraction helpers. Task 1 below reflects the corrected approach: run the workflow directly for its final string result, then have the route itself emit the client-facing stream, instead of proxying `handleWorkflowStream`'s output. Task 2 and Task 3 are unaffected — they already only assumed a stream of plain `text` parts, which this correction still provides.

## Global Constraints

- No test runner is configured in this project (see `CLAUDE.md`) — verification steps are manual (`pnpm dev` + browser + Ollama running locally).
- Do not modify `weatherAgent`'s instructions/tools or the `weatherWorkflow`'s step logic — only wire it up.
- `pnpm lint` must pass after each task.
- Follow existing code style: no semicolons are used inconsistently in this repo (existing files mix both) — match the file you're editing.

---

### Task 1: `/api/activities` route — run the workflow, stream to client, persist to memory

**Files:**
- Create: `src/mastra/constants.ts`
- Modify: `src/app/api/chat/route.ts` (use the shared constant instead of its local one)
- Create: `src/app/api/activities/route.ts`

**Interfaces:**
- Consumes: `mastra` singleton (`src/mastra/index.ts`, already exports `mastra`), `weatherWorkflow` registered under the key `weatherWorkflow` in `mastra/index.ts`'s `workflows: { weatherWorkflow }`, `handleWorkflowStream`/`createUIMessageStreamResponse` from `@mastra/ai-sdk`/`ai`.
- Produces: `POST /api/activities` accepting JSON body `{ city: string; threadId: string }`, responding with the same SSE `UIMessageChunk` stream shape `/api/chat`'s `POST` already returns (so the client can decode it the same way). Also exports the shared `RESOURCE_ID` constant from `src/mastra/constants.ts` for later tasks/routes to reuse.

- [ ] **Step 1: Extract the shared resource id constant**

Create `src/mastra/constants.ts`:

```ts
export const RESOURCE_ID = 'weather-chat'
```

- [ ] **Step 2: Point `/api/chat/route.ts` at the shared constant**

In `src/app/api/chat/route.ts`, replace the local declaration:

```ts
const RESOURCE_ID = 'weather-chat'
```

with:

```ts
import { RESOURCE_ID } from '@/mastra/constants'
```

(add this import alongside the existing `import { mastra } from '@/mastra'` line; remove the old `const RESOURCE_ID = 'weather-chat'` line).

- [ ] **Step 3: Verify `/api/chat` still type-checks and runs**

Run: `pnpm lint`
Expected: no errors introduced in `src/app/api/chat/route.ts`.

- [ ] **Step 4: Write the `/api/activities` route**

Create `src/app/api/activities/route.ts`:

```ts
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { mastra } from '@/mastra'
import { RESOURCE_ID } from '@/mastra/constants'
import { NextResponse } from 'next/server'

const CHUNK_SIZE = 40
const CHUNK_DELAY_MS = 15

function splitIntoChunks(text: string, size: number): string[] {
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size))
  }
  return chunks
}

async function runActivityWorkflow(city: string): Promise<string> {
  const workflow = mastra.getWorkflow('weatherWorkflow')
  const run = await workflow.createRun()
  const result = await run.start({ inputData: { city } })

  if (result.status !== 'success') {
    throw new Error(`Activity workflow did not complete successfully (status: ${result.status})`)
  }

  return result.result.activities
}

async function persistActivityPlan(threadId: string, messageId: string, text: string) {
  const memory = await mastra.getAgentById('weather-agent').getMemory()
  if (!memory) return

  await memory.saveMessages({
    messages: [
      {
        id: messageId,
        role: 'assistant',
        createdAt: new Date(),
        threadId,
        resourceId: RESOURCE_ID,
        content: {
          format: 2,
          parts: [{ type: 'text', text }],
        },
      },
    ],
  })
}

export async function POST(req: Request) {
  const body = (await req.json()) as { city?: string; threadId?: string }
  const { city, threadId } = body

  if (!city || !threadId) {
    return NextResponse.json({ error: 'city and threadId are required' }, { status: 400 })
  }

  const messageId = crypto.randomUUID()

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const text = await runActivityWorkflow(city)

      writer.write({ type: 'start', messageId })
      writer.write({ type: 'text-start', id: messageId })

      for (const chunk of splitIntoChunks(text, CHUNK_SIZE)) {
        writer.write({ type: 'text-delta', id: messageId, delta: chunk })
        await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY_MS))
      }

      writer.write({ type: 'text-end', id: messageId })
      writer.write({ type: 'finish' })

      await persistActivityPlan(threadId, messageId, text)
    },
  })

  return createUIMessageStreamResponse({ stream })
}
```

- [ ] **Step 5: Run lint**

Run: `pnpm lint`
Expected: no errors in `src/app/api/activities/route.ts`. If `memory.saveMessages`'s `messages` param rejects the object literal's shape, check the exact type at `node_modules/@mastra/core/dist/agent/message-list/state/types.d.ts` (`MastraDBMessage`) and adjust the object literal to match (this was verified against that file while planning, but adjust if the installed version differs). If `workflow.createRun()` or `run.start()` signatures differ from what's shown here, check `node_modules/@mastra/core/dist/workflows/workflow.d.ts` (`createRun`, `start` methods) and `.../workflows/types.d.ts` (`WorkflowResult`) and adjust accordingly — these were verified against that file while planning, but adjust if the installed version differs. If `writer.write({ type: 'start', ... })` rejects the object shape, check the `UIMessageStreamWriter`/`UIMessageChunk` types in `node_modules/ai/dist/index.d.ts` and adjust the chunk objects to match (the `start`/`text-start`/`text-delta`/`text-end`/`finish` chunk types are standard AI SDK v5 UI message stream chunks).

- [ ] **Step 6: Manual verification (requires Ollama running locally and `pnpm dev`)**

1. Start Ollama (`ollama serve` if not already running) and `pnpm dev`.
2. In the app, start a new chat thread and ask "What's the weather in Tokyo?" so a real `threadId` and a weather tool result exist.
3. In a separate terminal, grab that thread's id from the URL (`/chat?thread=<id>`) and run:
   ```bash
   curl -N -X POST http://localhost:3000/api/activities \
     -H "Content-Type: application/json" \
     -d '{"city":"Tokyo","threadId":"<id>"}'
   ```
4. Expected: the terminal streams SSE `data: {...}` lines whose `type` field cycles through `start`, `text-start`, repeated `text-delta` (each carrying a `delta` fragment of the plan text — confirm this via e.g. `grep -o '"type":"[a-z-]*"' | sort | uniq -c` on the raw response, which should show many `text-delta` occurrences), `text-end`, `finish`. The full activity plan text (the `📅 ... 🌡️ WEATHER SUMMARY ...` template from `weather-workflow.ts`) should be reconstructable by concatenating all the `delta` values in order.
5. Reload `/chat?thread=<id>` in the browser and confirm the activity plan text is NOT yet visibly rendered specially (Task 3 wires up rendering) but check via `GET /api/chat?threadId=<id>` (open that URL directly) that the response JSON now includes an assistant message containing the activity-plan text — this confirms persistence worked. If it's still missing, inspect `mastra.db` directly (e.g. `sqlite3 mastra.db "select * from mastra_messages order by createdAt desc limit 5;"` or the actual messages table name found via `.tables`) to check whether `saveMessages` threw silently or the row simply isn't there, and fix `persistActivityPlan` accordingly.

- [ ] **Step 7: Commit**

```bash
git add src/mastra/constants.ts src/app/api/chat/route.ts src/app/api/activities/route.ts
git commit -m "feat: add /api/activities route wiring up the weather activity-plan workflow"
```

---

### Task 2: Activity plan UI components

**Files:**
- Create: `src/components/activity-plan.tsx`

**Interfaces:**
- Consumes: `MessageResponse` from `@/components/ai-elements/message` (existing Markdown renderer), `Button` from `@/components/ui/button` (existing shadcn button), `POST /api/activities` from Task 1 (body `{ city, threadId }`, SSE `UIMessageChunk` response).
- Produces:
  - `SuggestActivitiesButton({ city, threadId, onMessage }: { city: string; threadId: string; onMessage: (message: UIMessage) => void })` — a button component. On click, POSTs to `/api/activities`, decodes the stream, and calls `onMessage(message)` once per progressively-updated message (same message `id` reused, caller is expected to upsert by id).
  - `ActivityPlanCard({ message }: { message: UIMessage })` — renders a message's text parts inside a visually distinct bordered card.
  - `isActivityPlanMessage(message: UIMessage): boolean` — detects whether a message (including ones reloaded from memory, which won't carry the live `metadata` tag) should render as an `ActivityPlanCard`. Detects via `message.metadata` tag (set by `SuggestActivitiesButton`) OR, as a fallback for reloaded history, whether the message is from the assistant and its text starts with the `📅` marker that the `planActivities` workflow step's prompt template always produces.

- [ ] **Step 1: Write the components**

Create `src/components/activity-plan.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema, type UIMessage, type UIMessageChunk } from 'ai'
import { Loader2Icon, SparklesIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { MessageResponse } from '@/components/ai-elements/message'

export type ActivityPlanMetadata = { kind: 'activity-plan' }

export function isActivityPlanMessage(message: UIMessage): boolean {
  const metadata = message.metadata as ActivityPlanMetadata | undefined
  if (metadata?.kind === 'activity-plan') return true

  if (message.role !== 'assistant') return false

  const text = message.parts
    ?.filter(part => part.type === 'text')
    .map(part => (part as { text: string }).text)
    .join('')
    .trim()

  return Boolean(text?.startsWith('📅'))
}

function getMessageText(message: UIMessage): string {
  return (
    message.parts
      ?.filter(part => part.type === 'text')
      .map(part => (part as { text: string }).text)
      .join('') ?? ''
  )
}

export function ActivityPlanCard({ message }: { message: UIMessage }) {
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wide">
        <SparklesIcon className="size-3.5" />
        Activity Plan
      </div>
      <MessageResponse>{getMessageText(message)}</MessageResponse>
    </div>
  )
}

export function SuggestActivitiesButton({
  city,
  threadId,
  onMessage,
}: {
  city: string
  threadId: string
  onMessage: (message: UIMessage) => void
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')

  const handleClick = async () => {
    setStatus('loading')

    try {
      const res = await fetch('/api/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city, threadId }),
      })

      if (!res.ok || !res.body) {
        throw new Error('Failed to generate activity plan')
      }

      const chunkStream = parseJsonEventStream({
        stream: res.body,
        schema: uiMessageChunkSchema,
      }).pipeThrough(
        new TransformStream<{ success: boolean; value?: UIMessageChunk; error?: unknown }, UIMessageChunk>({
          transform(chunk, controller) {
            if (!chunk.success || !chunk.value) {
              controller.error(chunk.error ?? new Error('Invalid activity plan stream chunk'))
              return
            }
            controller.enqueue(chunk.value)
          },
        })
      )

      for await (const message of readUIMessageStream({ stream: chunkStream })) {
        onMessage({ ...message, metadata: { kind: 'activity-plan' } as ActivityPlanMetadata })
      }

      setStatus('idle')
    } catch (error) {
      console.error('Failed to suggest activities', error)
      setStatus('error')
    }
  }

  return (
    <Button size="sm" variant="outline" className="gap-1.5" disabled={status === 'loading'} onClick={handleClick}>
      {status === 'loading' ? <Loader2Icon className="size-3.5 animate-spin" /> : <SparklesIcon className="size-3.5" />}
      {status === 'error' ? 'Try again' : 'Suggest activities'}
    </Button>
  )
}
```

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: no errors in `src/components/activity-plan.tsx`. If `parseJsonEventStream`/`uiMessageChunkSchema` generic typing conflicts with `readUIMessageStream`'s expected `ReadableStream<UIMessageChunk>` param, adjust the `TransformStream` generics or add a narrow `as ReadableStream<UIMessageChunk>` cast on `chunkStream` when passing it to `readUIMessageStream` — keep the runtime logic identical.

- [ ] **Step 3: Commit**

```bash
git add src/components/activity-plan.tsx
git commit -m "feat: add SuggestActivitiesButton and ActivityPlanCard components"
```

---

### Task 3: Wire the button and card into the chat UI

**Files:**
- Modify: `src/app/chat/page.tsx`

**Interfaces:**
- Consumes: `SuggestActivitiesButton`, `ActivityPlanCard`, `isActivityPlanMessage` from `@/components/activity-plan` (Task 2); existing `messages`, `setMessages`, `threadId` already in scope inside `ChatPanel`.

- [ ] **Step 1: Import the new components**

In `src/app/chat/page.tsx`, add to the imports (after the existing `Suggestion, Suggestions` import):

```tsx
import { ActivityPlanCard, SuggestActivitiesButton, isActivityPlanMessage } from '@/components/activity-plan'
```

- [ ] **Step 2: Render `ActivityPlanCard` for activity-plan messages**

In the `messages.map(message => ...)` block, find where each message's parts are rendered (the `<div className="flex min-w-0 max-w-[85%] flex-1 flex-col gap-2">{message.parts?.map(...)}</div>` block). Replace that inner block so activity-plan messages render via `ActivityPlanCard` instead of the normal part-by-part loop:

```tsx
<div className="flex min-w-0 max-w-[85%] flex-1 flex-col gap-2">
  {isActivityPlanMessage(message) ? (
    <ActivityPlanCard message={message} />
  ) : (
    message.parts?.map((part, i) => {
      if (part.type === 'text') {
        return (
          <Message key={`${message.id}-${i}`} from={message.role} className="max-w-full">
            <MessageContent>
              <MessageResponse>{part.text}</MessageResponse>
            </MessageContent>
          </Message>
        )
      }

      if (part.type?.startsWith('tool-')) {
        return (
          <Tool key={`${message.id}-${i}`}>
            <ToolHeader
              type={(part as ToolUIPart).type}
              state={(part as ToolUIPart).state || 'output-available'}
              className="cursor-pointer"
            />
            <ToolContent>
              <ToolInput input={(part as ToolUIPart).input || {}} />
              <ToolOutput output={(part as ToolUIPart).output} errorText={(part as ToolUIPart).errorText} />
              {part.type === 'tool-get-weather' &&
                (part as ToolUIPart).state === 'output-available' &&
                (() => {
                  const output = (part as ToolUIPart).output as { location?: string } | undefined
                  if (!output?.location) return null
                  return (
                    <SuggestActivitiesButton
                      city={output.location}
                      threadId={threadId}
                      onMessage={newMessage =>
                        setMessages(prev => [...prev.filter(m => m.id !== newMessage.id), newMessage])
                      }
                    />
                  )
                })()}
            </ToolContent>
          </Tool>
        )
      }

      return null
    })
  )}
</div>
```

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: no errors in `src/app/chat/page.tsx`.

- [ ] **Step 4: Manual end-to-end verification**

1. Ensure Ollama is running (`ollama serve`) and run `pnpm dev`.
2. Open `/chat`, start a new thread, ask "What's the weather in Tokyo?".
3. Once the weather tool card appears with a result, confirm a "Suggest activities" button is visible inside its expanded content.
4. Click it. Expected: the button shows a spinner, then a new bordered "Activity Plan" card appears below in the conversation and its text streams in progressively (not all at once).
5. Wait for it to finish; the button returns to its normal "Suggest activities" state (clickable again).
6. Reload the page (same `?thread=` URL). Expected: the Activity Plan card is still present, still styled distinctly (confirms both persistence from Task 1 and the `isActivityPlanMessage` reload-detection fallback from Task 2 work together).
7. Try a city that fails geocoding (e.g. "Suggest activities" flow triggered for a nonsense location, or stop Ollama and retry) — expected: the button shows "Try again" instead of crashing the chat.

- [ ] **Step 5: Commit**

```bash
git add src/app/chat/page.tsx
git commit -m "feat: wire Suggest Activities button and Activity Plan card into chat UI"
```
