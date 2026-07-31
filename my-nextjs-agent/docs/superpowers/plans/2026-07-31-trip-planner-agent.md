# Trip Planner Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second Mastra agent (`tripPlannerAgent`) that produces a multi-day itinerary by calling the existing `weatherAgent` through a new agent-as-tool (`askWeatherAgentTool`), triggered by a new "Plan my trip" button on the existing `ActivityPlanCard`.

**Architecture:** `tripPlannerAgent` is a stateless (no `Memory`) Mastra agent with one tool, `askWeatherAgentTool`, whose `execute` calls `weatherAgent.stream()` and returns the accumulated text. A new `POST /api/trip-plan` route streams `tripPlannerAgent`'s output token-by-token (real streaming, unlike `/api/activities`'s chunked-replay of a finished workflow result) and persists the result through `weatherAgent`'s memory store, same as activity plans. A new `trip-plan.tsx` component (mirroring `activity-plan.tsx`) renders the result and the triggering button, which is wired into `ActivityPlanCard` via a small `children` slot.

**Tech Stack:** Mastra (`@mastra/core` Agent/Tool), Vercel AI SDK v5 (`ai` package: `createUIMessageStream`, `readUIMessageStream`, `parseJsonEventStream`), Next.js App Router route handlers, React/shadcn UI (`Button`, `Input`).

**No test runner is configured in this project** (confirmed in `.claude/CLAUDE.md`), so this plan replaces automated red/green test steps with `pnpm lint` after each code change and manual, in-browser verification at integration points — the same verification style the existing activity-plan feature was built and shipped with.

**Per explicit user instruction: no `git commit` steps are included anywhere in this plan.** Do not commit as part of executing it, even though the writing-plans template normally ends each task with a commit step — that step is intentionally omitted throughout. Leave changes staged/unstaged for the user to commit themselves.

## Deviation from the approved spec

The spec (`docs/superpowers/specs/2026-07-31-trip-planner-agent-design.md`, Backend §2/§4) calls for forcing `toolChoice: { type: 'tool', toolName: 'askWeatherAgentTool' }` on `tripPlannerAgent`'s run, to guarantee the weather tool gets called before the itinerary is written.

This plan does **not** implement that forced `toolChoice`, for a concrete reason: `tripPlannerAgent.stream(...)` runs Mastra's normal multi-step tool-calling loop (the same mechanism `weatherAgent` already uses for `weatherTool`/`setTemperatureUnitTool` in production today). A `toolChoice` value forcing one specific tool applies to *every step* of that loop, not just the first — there's no evidence in this codebase (no prior use of forced `toolChoice` inside a multi-step agent run; `weather-workflow.ts`'s `{ toolChoice: 'none' }` is a single-turn, tools-disabled call, not a comparable case) that Mastra automatically relaxes it back to `'auto'` after one call. Forcing it here risks the model being forced to call `askWeatherAgentTool` again on every subsequent step instead of ever producing the itinerary text — an infinite-tool-call loop with no automated test suite to catch it.

Instead, `tripPlannerAgent` relies on strong, explicit instructions to call the tool first — the same mechanism `weatherAgent` already relies on (successfully, in the shipped app) to decide when to call `weatherTool`. Task 9's manual verification step below explicitly checks that the tool is actually invoked before accepting the feature as working; if the local model doesn't reliably comply, that's a known limitation of unforced tool-calling on a small local model, consistent with the app's existing tradeoffs elsewhere (e.g. `weatherAgent`'s own working-memory instructions aren't force-enforced either).

---

### Task 1: Extract the shared Ollama client

`weather-agent.ts` and the new `trip-planner-agent.ts` (Task 3) both need the same `createOpenAICompatible` Ollama client. Rather than duplicating the four-line construction in two files, pull it into one shared module both agents import — a small, targeted cleanup, not a broader refactor.

**Files:**
- Create: `src/mastra/model.ts`
- Modify: `src/mastra/agents/weather-agent.ts:1-10`

- [ ] **Step 1: Create the shared model module**

Create `src/mastra/model.ts`:

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export const ollama = createOpenAICompatible({
  name: 'ollama',
  baseURL: 'http://localhost:11434/v1',
});
```

- [ ] **Step 2: Update `weather-agent.ts` to import it**

In `src/mastra/agents/weather-agent.ts`, replace:

```ts
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { weatherTool } from '../tools/weather-tool';
import { setTemperatureUnitTool } from '../tools/set-temperature-unit-tool';

const ollama = createOpenAICompatible({
  name: 'ollama',
  baseURL: 'http://localhost:11434/v1',
});
```

with:

```ts
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { ollama } from '../model';
import { weatherTool } from '../tools/weather-tool';
import { setTemperatureUnitTool } from '../tools/set-temperature-unit-tool';
```

The rest of `weather-agent.ts` (the `new Agent({...})` call using `ollama('llama3.1')`) is unchanged.

- [ ] **Step 3: Verify**

Run: `pnpm lint`
Expected: no errors, no unused-import warnings for `weather-agent.ts`.

---

### Task 2: Create `askWeatherAgentTool`

The agent-as-tool wrapper: a plain Mastra tool whose `execute` calls `weatherAgent` and returns its text response, so `tripPlannerAgent` (Task 3) can call it like any other tool.

**Files:**
- Create: `src/mastra/tools/ask-weather-agent-tool.ts`

- [ ] **Step 1: Write the tool**

Create `src/mastra/tools/ask-weather-agent-tool.ts`:

```ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { weatherAgent } from '../agents/weather-agent';

export const askWeatherAgentTool = createTool({
  id: 'ask-weather-agent',
  description:
    'Ask the weather agent for a short description of current weather conditions in a city. Use this to ground a trip itinerary in real conditions.',
  inputSchema: z.object({
    city: z.string().describe('The city to get current weather conditions for'),
  }),
  outputSchema: z.object({
    weather: z.string(),
  }),
  execute: async (inputData) => {
    const { city } = inputData;

    try {
      const response = await weatherAgent.stream([
        {
          role: 'user',
          content: `What's the current weather in ${city}? Give me the conditions, temperature, and precipitation chance in a couple of sentences.`,
        },
      ]);

      let weather = '';
      for await (const chunk of response.textStream) {
        weather += chunk;
      }

      return { weather };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { weather: `Could not get weather for ${city}: ${message}` };
    }
  },
});
```

This mirrors the exact `agent.stream([...]) ` + `for await (const chunk of response.textStream)` shape already proven in `src/mastra/workflows/weather-workflow.ts:151-166`. No `toolChoice` is passed here either — this is a deliberate extension of the same "Deviation from the approved spec" reasoning above (the spec's Backend §1 suggested `{ toolChoice: 'auto' }`, which is Mastra's default anyway and adds nothing): `weatherAgent` decides on its own whether to call `weatherTool`, exactly as it does in normal chat via `/api/chat`, with no forced choice anywhere in this call chain.

The `try`/`catch` means a failure inside `weatherAgent` (bad city name, Ollama unreachable) becomes a descriptive tool *output* string instead of an exception that would abort `tripPlannerAgent`'s whole run.

- [ ] **Step 2: Verify**

Run: `pnpm lint`
Expected: no errors.

---

### Task 3: Create `tripPlannerAgent`

**Files:**
- Create: `src/mastra/agents/trip-planner-agent.ts`

- [ ] **Step 1: Write the agent**

Create `src/mastra/agents/trip-planner-agent.ts`:

```ts
import { Agent } from '@mastra/core/agent';
import { ollama } from '../model';
import { askWeatherAgentTool } from '../tools/ask-weather-agent-tool';

export const tripPlannerAgent = new Agent({
  id: 'trip-planner-agent',
  name: 'Trip Planner Agent',
  instructions: `You are a trip planning assistant that builds multi-day itineraries for a named city.

Always call the askWeatherAgentTool tool first, with the requested city, before writing anything else. Do not skip this step and do not write any itinerary content before you have the tool's result.

The tool only reports current weather conditions, not a day-by-day forecast. Do not claim to know what the weather will be like on future days — use the current conditions only as a general sense of the season/climate, and vary the *activities* and *pacing* across days rather than inventing different weather for each day.

For each day, use this exact format (the leading "🧳 Day N" line is required and must appear at the start of the line for every day):

🧳 Day N — [short theme for the day, e.g. "Old Town & Local Food"]
═══════════════════════════
Morning: [activity] — [one sentence why]
Afternoon: [activity] — [one sentence why]
Evening: [activity] — [one sentence why]

After the last day, add exactly one closing section:

⚠️ NOTE
[one sentence reminding the reader this itinerary is based on current conditions, not a per-day forecast]

Produce exactly the number of days requested in the user's message — no more, no fewer. Keep each activity description to one concise sentence.`,
  model: ollama('llama3.1'),
  tools: { askWeatherAgentTool },
});
```

The `🧳 Day N` marker is the fixed, agent-emitted prefix `isTripPlanMessage` (Task 6) matches on to recognize a trip plan after a page reload, mirroring how `isActivityPlanMessage` matches on `📅` in `src/components/activity-plan.tsx:24`.

- [ ] **Step 2: Verify**

Run: `pnpm lint`
Expected: no errors.

---

### Task 4: Register `tripPlannerAgent` in the Mastra instance

**Files:**
- Modify: `src/mastra/index.ts`

- [ ] **Step 1: Import and register the agent**

In `src/mastra/index.ts`, add the import near the existing `weatherAgent` import:

```ts
import { weatherAgent } from './agents/weather-agent';
import { tripPlannerAgent } from './agents/trip-planner-agent';
```

And update the `agents` field of the `new Mastra({...})` call:

```ts
    agents: { weatherAgent, tripPlannerAgent },
```

(it currently reads `agents: { weatherAgent },`).

- [ ] **Step 2: Verify agent registration manually**

Run: `pnpm dev` (requires a local Ollama server running with `llama3.1` pulled, per `.claude/CLAUDE.md`) and in a separate terminal:

```bash
curl -s -X POST http://localhost:3000/api/chat -H "Content-Type: application/json" -d '{"threadId":"smoke-test","messages":[{"role":"user","parts":[{"type":"text","text":"hi"}]}]}' | head -c 200
```

Expected: some streamed response, confirming the Mastra instance still boots with the new agent registered (a broken registration would surface as a server error on any route, since `mastra` is instantiated once at module load). Stop the dev server after this check.

---

### Task 5: Create the `/api/trip-plan` route

**Files:**
- Create: `src/app/api/trip-plan/route.ts`

- [ ] **Step 1: Write the route**

Create `src/app/api/trip-plan/route.ts`:

```ts
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { mastra } from '@/mastra'
import { RESOURCE_ID } from '@/mastra/constants'
import { NextResponse } from 'next/server'

async function persistTripPlan(threadId: string, messageId: string, text: string) {
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
  const body = (await req.json()) as { city?: string; days?: number; threadId?: string }
  const { city, days, threadId } = body

  if (!city || !days || !threadId) {
    return NextResponse.json({ error: 'city, days, and threadId are required' }, { status: 400 })
  }

  const messageId = crypto.randomUUID()

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const tripPlannerAgent = mastra.getAgentById('trip-planner-agent')

      const response = await tripPlannerAgent.stream([
        {
          role: 'user',
          content: `Plan a ${days}-day trip to ${city}.`,
        },
      ])

      writer.write({ type: 'start', messageId })
      writer.write({ type: 'text-start', id: messageId })

      let text = ''
      for await (const chunk of response.textStream) {
        text += chunk
        writer.write({ type: 'text-delta', id: messageId, delta: chunk })
      }

      writer.write({ type: 'text-end', id: messageId })
      writer.write({ type: 'finish' })

      await persistTripPlan(threadId, messageId, text)
    },
  })

  return createUIMessageStreamResponse({ stream })
}
```

This mirrors `src/app/api/activities/route.ts`'s `writer`/`createUIMessageStream` shape and `persistActivityPlan`'s memory-saving shape exactly, but feeds `writer.write({ type: 'text-delta', ... })` from a live `.textStream` instead of replaying pre-split chunks of an already-finished string — genuine token-by-token streaming.

- [ ] **Step 2: Verify with a direct curl smoke test**

With `pnpm dev` running (and Ollama up) in one terminal, in another:

```bash
curl -s -N -X POST http://localhost:3000/api/trip-plan \
  -H "Content-Type: application/json" \
  -d '{"city":"Lisbon","days":2,"threadId":"smoke-test"}'
```

Expected: a stream of SSE-style JSON chunks ending in a `finish` event, whose accumulated text-deltas read as a 2-day itinerary starting each day with `🧳 Day`. If the response is an error or the text doesn't follow the format, check the terminal running `pnpm dev` for the actual error (most likely cause: Ollama not running, or `llama3.1` not pulled).

Stop the dev server after this check.

---

### Task 6: Create `src/components/trip-plan.tsx`

**Files:**
- Create: `src/components/trip-plan.tsx`

- [ ] **Step 1: Write the component module**

Create `src/components/trip-plan.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema, type UIMessage, type UIMessageChunk } from 'ai'
import { Loader2Icon, MapIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MessageResponse } from '@/components/ai-elements/message'

export type TripPlanMetadata = { kind: 'trip-plan' }

export function isTripPlanMessage(message: UIMessage): boolean {
  const metadata = message.metadata as TripPlanMetadata | undefined
  if (metadata?.kind === 'trip-plan') return true

  if (message.role !== 'assistant') return false

  const text = message.parts
    ?.filter(part => part.type === 'text')
    .map(part => (part as { text: string }).text)
    .join('')
    .trim()

  return Boolean(text?.startsWith('🧳'))
}

function getMessageText(message: UIMessage): string {
  return (
    message.parts
      ?.filter(part => part.type === 'text')
      .map(part => (part as { text: string }).text)
      .join('') ?? ''
  )
}

export function TripPlanCard({ message }: { message: UIMessage }) {
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wide">
        <MapIcon className="size-3.5" />
        Trip Itinerary
      </div>
      <MessageResponse>{getMessageText(message)}</MessageResponse>
    </div>
  )
}

export function PlanTripButton({
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
  const [status, setStatus] = useState<'idle' | 'selecting' | 'loading' | 'error'>('idle')
  const [days, setDays] = useState(3)

  const handlePlan = async () => {
    if (disabled) return
    setStatus('loading')

    try {
      const res = await fetch('/api/trip-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city, days, threadId }),
      })

      if (!res.ok || !res.body) {
        throw new Error('Failed to generate trip plan')
      }

      const chunkStream = parseJsonEventStream({
        stream: res.body,
        schema: uiMessageChunkSchema,
      }).pipeThrough(
        new TransformStream<{ success: boolean; value?: UIMessageChunk; error?: unknown }, UIMessageChunk>({
          transform(chunk, controller) {
            if (!chunk.success || !chunk.value) {
              controller.error(chunk.error ?? new Error('Invalid trip plan stream chunk'))
              return
            }
            controller.enqueue(chunk.value)
          },
        })
      )

      for await (const message of readUIMessageStream({ stream: chunkStream })) {
        onMessage({ ...message, metadata: { kind: 'trip-plan' } as TripPlanMetadata })
      }

      setStatus('idle')
    } catch (error) {
      console.error('Failed to plan trip', error)
      setStatus('error')
    }
  }

  if (status === 'idle' || status === 'error') {
    return (
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        disabled={disabled}
        onClick={() => setStatus('selecting')}
      >
        <MapIcon className="size-3.5" />
        {status === 'error' ? 'Try again' : 'Plan my trip'}
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
        disabled={status === 'loading' || disabled}
        onChange={e => setDays(Math.min(7, Math.max(1, Number(e.target.value) || 1)))}
        className="w-16"
      />
      <span className="text-muted-foreground text-xs">days</span>
      <Button size="sm" variant="outline" disabled={status === 'loading' || disabled} onClick={handlePlan}>
        {status === 'loading' ? <Loader2Icon className="size-3.5 animate-spin" /> : 'Go'}
      </Button>
    </div>
  )
}
```

`disabled` is threaded through to every actual `<button>`/`<input>` in both render branches (both the "Plan my trip"/"Try again" button and the day-count `Input` + "Go" button), and `handlePlan` early-returns if `disabled` — per the `guarding-streaming-ui-actions` skill's pattern, so a click can't fire a request while the main chat is mid-stream (Task 7 wires `disabled` to the chat's `status !== 'ready'`).

- [ ] **Step 2: Verify**

Run: `pnpm lint`
Expected: no errors. (This step only typechecks/lints in isolation — the component isn't rendered anywhere yet, so there's nothing to click yet. End-to-end behavior is verified in Task 8.)

---

### Task 7: Stamp `city` onto activity-plan messages and add a `children` slot to `ActivityPlanCard`

**Files:**
- Modify: `src/components/activity-plan.tsx`

- [ ] **Step 1: Widen the metadata type and stamp `city`**

In `src/components/activity-plan.tsx`, change:

```ts
export type ActivityPlanMetadata = { kind: 'activity-plan' }
```

to:

```ts
export type ActivityPlanMetadata = { kind: 'activity-plan'; city?: string }
```

Then, in `SuggestActivitiesButton`'s `onMessage` call (currently `src/components/activity-plan.tsx:88-90`):

```ts
      for await (const message of readUIMessageStream({ stream: chunkStream })) {
        onMessage({ ...message, metadata: { kind: 'activity-plan' } as ActivityPlanMetadata })
      }
```

change to:

```ts
      for await (const message of readUIMessageStream({ stream: chunkStream })) {
        onMessage({ ...message, metadata: { kind: 'activity-plan', city } as ActivityPlanMetadata })
      }
```

(`city` is already in scope — it's a prop of `SuggestActivitiesButton`.)

- [ ] **Step 2: Add a `children` slot to `ActivityPlanCard`**

Change:

```tsx
import { useState } from 'react'
```

to:

```tsx
import { useState, type ReactNode } from 'react'
```

Then change:

```tsx
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
```

to:

```tsx
export function ActivityPlanCard({ message, children }: { message: UIMessage; children?: ReactNode }) {
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wide">
        <SparklesIcon className="size-3.5" />
        Activity Plan
      </div>
      <MessageResponse>{getMessageText(message)}</MessageResponse>
      {children && <div className="pt-1">{children}</div>}
    </div>
  )
}
```

This mirrors the existing `children`-slot pattern already used by `WeatherCard` in `src/components/weather-card.tsx:19-46`.

- [ ] **Step 3: Verify**

Run: `pnpm lint`
Expected: no errors.

---

### Task 8: Wire `PlanTripButton` into `chat/page.tsx`

**Files:**
- Modify: `src/app/chat/page.tsx`

- [ ] **Step 1: Import the new component and metadata type**

In `src/app/chat/page.tsx`, add to the imports (near the existing `ActivityPlanCard` import at line 34):

```tsx
import { ActivityPlanCard, type ActivityPlanMetadata, SuggestActivitiesButton, isActivityPlanMessage } from '@/components/activity-plan'
import { PlanTripButton } from '@/components/trip-plan'
```

(only the `import { PlanTripButton } from '@/components/trip-plan'` line and adding `ActivityPlanMetadata` to the existing import are new).

- [ ] **Step 2: Convert the messages `.map` callback to a block body and render `PlanTripButton`**

Currently (`src/app/chat/page.tsx:95-170`) the callback is a single JSX expression:

```tsx
          {messages.map(message => (
            <div
              key={message.id}
              className={`flex items-start gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                {message.role === 'user' ? (
                  <UserIcon className="size-4" />
                ) : (
                  <BotIcon className="size-4" />
                )}
              </div>

              <div className="flex min-w-0 max-w-[85%] flex-1 flex-col gap-2">
                {isActivityPlanMessage(message) ? (
                  <ActivityPlanCard message={message} />
                ) : (
                  message.parts?.map((part, i) => {
                    ...
                  })
                )}
              </div>
            </div>
          ))}
```

Change the arrow function to a block body (so a local `const` can read the message's `city`), and pass a `PlanTripButton` as `ActivityPlanCard`'s `children` when a city is present:

```tsx
          {messages.map(message => {
            const activityPlanCity = isActivityPlanMessage(message)
              ? (message.metadata as ActivityPlanMetadata | undefined)?.city
              : undefined

            return (
              <div
                key={message.id}
                className={`flex items-start gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
              >
                <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  {message.role === 'user' ? (
                    <UserIcon className="size-4" />
                  ) : (
                    <BotIcon className="size-4" />
                  )}
                </div>

                <div className="flex min-w-0 max-w-[85%] flex-1 flex-col gap-2">
                  {isActivityPlanMessage(message) ? (
                    <ActivityPlanCard message={message}>
                      {activityPlanCity && (
                        <PlanTripButton
                          city={activityPlanCity}
                          threadId={threadId}
                          disabled={status !== 'ready'}
                          onMessage={newMessage =>
                            setMessages(prev => [...prev.filter(m => m.id !== newMessage.id), newMessage])
                          }
                        />
                      )}
                    </ActivityPlanCard>
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

                      if (part.type === 'tool-weatherTool') {
                        const toolPart = part as ToolUIPart

                        if (toolPart.state === 'output-error') {
                          return <WeatherCardError key={`${message.id}-${i}`} message={toolPart.errorText} />
                        }

                        if (toolPart.state === 'output-available' && toolPart.output) {
                          const weather = toolPart.output as WeatherCardData
                          return (
                            <WeatherCard key={`${message.id}-${i}`} data={weather}>
                              <SuggestActivitiesButton
                                city={weather.location}
                                threadId={threadId}
                                onMessage={newMessage =>
                                  setMessages(prev => [...prev.filter(m => m.id !== newMessage.id), newMessage])
                                }
                              />
                            </WeatherCard>
                          )
                        }

                        const input = toolPart.input as { location?: string } | undefined
                        return <WeatherCardLoading key={`${message.id}-${i}`} location={input?.location} />
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
                            </ToolContent>
                          </Tool>
                        )
                      }

                      return null
                    })
                  )}
                </div>
              </div>
            )
          })}
```

Everything inside stays byte-for-byte the same except: the arrow function now has an explicit `return`, the new `activityPlanCity` const, and the `<ActivityPlanCard>` block gaining `children`.

`disabled={status !== 'ready'}` uses the `status` value already destructured from `useChat` at the top of `ChatPanel` (`src/app/chat/page.tsx:42`) — this is the `guarding-streaming-ui-actions` guard, so the button (and the day-count input inside it) can't be used while the main chat is mid-stream.

- [ ] **Step 3: Verify**

Run: `pnpm lint`
Expected: no errors.

---

### Task 9: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the app**

Ensure a local Ollama server is running with `llama3.1` pulled (per `.claude/CLAUDE.md`), then run `pnpm dev` and open `http://localhost:3000/chat`.

- [ ] **Step 2: Drive the golden path**

1. Start a new chat thread, ask "What's the weather in Lisbon?" and wait for the `WeatherCard` to appear.
2. Click "Suggest activities" and wait for the `ActivityPlanCard` to appear with its plan text.
3. Confirm a "Plan my trip" button now appears inside that `ActivityPlanCard`.
4. Click it, confirm the inline day-count input appears (default `3`), change it to `2`, click "Go".
5. Confirm a new `TripPlanCard` ("Trip Itinerary") streams in token-by-token below, containing exactly 2 sections each starting with `🧳 Day`.
6. Check the terminal running `pnpm dev` (or Mastra's observability/logs) for evidence `askWeatherAgentTool` → `weatherAgent` actually ran (e.g. a log line mentioning `ask-weather-agent` or `weatherTool`/geocoding fetch activity) — this is the check called for in "Deviation from the approved spec" above, confirming the unforced tool-choice instructions were followed.

- [ ] **Step 3: Verify the guard and reload behavior**

1. While a normal chat message is streaming (ask another weather question and, before it finishes, try clicking "Plan my trip" on an earlier `ActivityPlanCard`). Confirm the button is disabled and does nothing until the stream finishes.
2. Reload the page (same thread). Confirm the `ActivityPlanCard` and `TripPlanCard` both still render correctly from persisted history, and confirm the `ActivityPlanCard` no longer shows a "Plan my trip" button after reload (the accepted "known limitation" from the spec — city metadata isn't persisted).

- [ ] **Step 4: Verify error handling**

Stop the Ollama server, click "Plan my trip" → pick a day count → "Go" on any existing `ActivityPlanCard`. Confirm the button flips to a "Try again" state rather than crashing the page or leaving a half-rendered card. Restart Ollama afterward.

---

### Task 10: Final build check

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck + production build**

Run: `pnpm build`
Expected: build succeeds with no TypeScript errors (this exercises the whole project's types, including the new files, more strictly than `pnpm lint` alone).

- [ ] **Step 2: Final lint pass**

Run: `pnpm lint`
Expected: no errors or warnings across the whole project.
