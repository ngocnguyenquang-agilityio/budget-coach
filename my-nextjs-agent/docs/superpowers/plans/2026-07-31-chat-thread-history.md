# Chat Thread History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single hardcoded chat thread with a multi-thread conversation history: a sidebar listing past conversations (auto-titled from the first message), the ability to start a new chat, switch between threads, and delete a thread.

**Architecture:** Add two new API routes (`/api/threads` for list/create, `/api/threads/[threadId]` for delete) that call Mastra `Memory`'s existing thread CRUD methods (`listThreads`, `createThread`, `updateThread`, `deleteThread`). Modify `/api/chat` to take `threadId` from the request instead of a hardcoded constant, and to auto-title a thread from its first user message. On the frontend, split `chat/page.tsx` into a container that owns `activeThreadId` (synced to a `?thread=` URL param) plus a new `ChatSidebar` component and a `ChatPanel` component (the old chat UI, now parameterized by `threadId` and remounted via `key` on thread switch).

**Tech Stack:** Next.js App Router route handlers, Mastra (`@mastra/memory`), `@ai-sdk/react`'s `useChat`/`DefaultChatTransport`, existing shadcn/ui `Button` + Tailwind, `lucide-react` icons. No test runner is configured in this project (confirmed in `.claude/CLAUDE.md`) — verification steps use `npx tsc --noEmit`, `pnpm lint`, `curl` against the running dev server, and manual browser exercise instead of automated tests.

## Global Constraints

- Package manager is pnpm — use `pnpm` for all script invocation, not `npm`/`yarn`.
- No test runner exists in this project — do not add one; verify via typecheck/lint/curl/manual run instead.
- A local Ollama server (`http://localhost:11434`, model `llama3.1`) must be running for any manual chat verification to work.
- `RESOURCE_ID` stays hardcoded as `'weather-chat'` (no auth in this app) — do not add per-user identity.
- Next.js 16 route handler dynamic params are async: `{ params }: { params: Promise<{ threadId: string }> }`, accessed via `const { threadId } = await params`.
- Thread titles are derived from the first user message text, truncated to 40 characters (no LLM call) — do not use Mastra's `generateTitle` option.
- Follow existing UI conventions: `src/components/ui/button.tsx` (shadcn `Button`, variants `default | outline | secondary | ghost | destructive`, sizes incl. `icon`/`icon-sm`), `lucide-react` icons, Tailwind utility classes matching `chat/page.tsx`'s existing style (`border-b`, `bg-muted`, `text-muted-foreground`, etc.).

---

### Task 1: `/api/threads` route — list and create threads

**Files:**
- Create: `src/app/api/threads/route.ts`

**Interfaces:**
- Produces: `GET /api/threads` → `200` JSON array of `{ id: string; title: string | null; createdAt: string; updatedAt: string }`, sorted newest-updated first.
- Produces: `POST /api/threads` (no body needed) → `200` JSON `{ id: string; title: string | null; createdAt: string; updatedAt: string }` for the newly created thread.
- Consumes: `mastra` singleton from `@/mastra`, matching the pattern already used in `src/app/api/chat/route.ts` (`mastra.getAgentById('weather-agent').getMemory()`).

- [ ] **Step 1: Write the route file**

```ts
import { NextResponse } from 'next/server'
import { mastra } from '@/mastra'

const RESOURCE_ID = 'weather-chat'

export async function GET() {
  const memory = await mastra.getAgentById('weather-agent').getMemory()

  if (!memory) {
    return NextResponse.json([], { status: 200 })
  }

  const result = await memory.listThreads({
    filter: { resourceId: RESOURCE_ID },
    orderBy: { field: 'updatedAt', direction: 'DESC' },
    perPage: false,
  })

  const threads = result.threads.map(thread => ({
    id: thread.id,
    title: thread.title ?? null,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  }))

  return NextResponse.json(threads)
}

export async function POST() {
  const memory = await mastra.getAgentById('weather-agent').getMemory()

  if (!memory) {
    return NextResponse.json({ error: 'weather-agent has no Memory instance configured' }, { status: 500 })
  }

  const thread = await memory.createThread({ resourceId: RESOURCE_ID })

  return NextResponse.json({
    id: thread.id,
    title: thread.title ?? null,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing `src/app/api/threads/route.ts`.

- [ ] **Step 3: Manual verification against the running dev server**

Start the dev server in the background: `pnpm dev` (leave running for the rest of this plan).

Run:
```bash
curl -s -X POST http://localhost:3000/api/threads
```
Expected: JSON object with a generated `id`, `title: null`, `createdAt`, `updatedAt`.

Run:
```bash
curl -s http://localhost:3000/api/threads
```
Expected: JSON array containing the thread just created.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/threads/route.ts
git commit -m "feat: add /api/threads list and create endpoints"
```

---

### Task 2: `/api/threads/[threadId]` route — delete a thread

**Files:**
- Create: `src/app/api/threads/[threadId]/route.ts`

**Interfaces:**
- Produces: `DELETE /api/threads/:threadId` → `200` JSON `{ deleted: true }` on success, `500` JSON `{ error: string }` if `weather-agent` has no `Memory` instance.

- [ ] **Step 1: Write the route file**

```ts
import { NextResponse } from 'next/server'
import { mastra } from '@/mastra'

export async function DELETE(_req: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params
  const memory = await mastra.getAgentById('weather-agent').getMemory()

  if (!memory) {
    return NextResponse.json({ error: 'weather-agent has no Memory instance configured' }, { status: 500 })
  }

  await memory.deleteThread(threadId)

  return NextResponse.json({ deleted: true })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing `src/app/api/threads/[threadId]/route.ts`.

- [ ] **Step 3: Manual verification**

With the dev server still running, create a throwaway thread and delete it:
```bash
THREAD_ID=$(curl -s -X POST http://localhost:3000/api/threads | node -e "process.stdin.on('data', d => process.stdout.write(JSON.parse(d).id))")
curl -s -X DELETE "http://localhost:3000/api/threads/$THREAD_ID"
curl -s http://localhost:3000/api/threads
```
Expected: the `DELETE` call returns `{"deleted":true}`, and the subsequent list no longer contains `$THREAD_ID`.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/threads/[threadId]/route.ts"
git commit -m "feat: add DELETE /api/threads/:threadId endpoint"
```

---

### Task 3: Rework `/api/chat` for dynamic `threadId` and auto-title

**Files:**
- Modify: `src/app/api/chat/route.ts`

**Interfaces:**
- Consumes: request body field `threadId: string` (sent by the frontend in Task 5 via `DefaultChatTransport`'s `body` option); query param `?threadId=` for `GET`.
- Produces: same streaming/JSON response shapes as before, now scoped to whichever `threadId` is passed instead of the old hardcoded constant.

- [ ] **Step 1: Replace the route file contents**

Current file (for reference):

```ts
import { handleChatStream } from '@mastra/ai-sdk'
import { toAISdkV5Messages } from '@mastra/ai-sdk/ui'
import { createUIMessageStreamResponse, type UIMessageChunk } from 'ai'
import { mastra } from '@/mastra'
import { NextResponse } from 'next/server'

const THREAD_ID = 'example-user-id'
const RESOURCE_ID = 'weather-chat'

export async function POST(req: Request) {
  const params = await req.json()
  const stream = await handleChatStream({
    mastra,
    agentId: 'weather-agent',
    params: {
      ...params,
      memory: {
        ...params.memory,
        thread: THREAD_ID,
        resource: RESOURCE_ID,
      },
    },
  })
  return createUIMessageStreamResponse({
    stream: stream as ReadableStream<UIMessageChunk>,
  })
}

export async function GET() {
  const memory = await mastra.getAgentById('weather-agent').getMemory()
  let response = null

  try {
    response = await memory?.recall({
      threadId: THREAD_ID,
      resourceId: RESOURCE_ID,
    })
  } catch {
    console.log('No previous messages found.')
  }

  const uiMessages = toAISdkV5Messages(response?.messages || [])

  return NextResponse.json(uiMessages)
}
```

Replace it with:

```ts
import { handleChatStream } from '@mastra/ai-sdk'
import { toAISdkV5Messages } from '@mastra/ai-sdk/ui'
import { createUIMessageStreamResponse, type UIMessageChunk } from 'ai'
import { mastra } from '@/mastra'
import { NextResponse } from 'next/server'

const RESOURCE_ID = 'weather-chat'

function extractLatestUserText(messages: unknown[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as { role?: string; parts?: Array<{ type?: string; text?: string }> }
    if (message?.role !== 'user') continue

    const text = message.parts
      ?.filter(part => part?.type === 'text' && typeof part.text === 'string')
      .map(part => part.text)
      .join(' ')
      .trim()

    if (text) return text
  }

  return null
}

function titleFromText(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > 40 ? `${trimmed.slice(0, 40).trimEnd()}…` : trimmed
}

export async function POST(req: Request) {
  const params = await req.json()
  const threadId: string | undefined = params.threadId

  if (!threadId) {
    return NextResponse.json({ error: 'threadId is required' }, { status: 400 })
  }

  const memory = await mastra.getAgentById('weather-agent').getMemory()

  if (memory) {
    const thread = await memory.getThreadById({ threadId })
    if (thread && !thread.title) {
      const latestUserText = extractLatestUserText(params.messages ?? [])
      if (latestUserText) {
        await memory.updateThread({ id: threadId, title: titleFromText(latestUserText) })
      }
    }
  }

  const stream = await handleChatStream({
    mastra,
    agentId: 'weather-agent',
    params: {
      ...params,
      memory: {
        ...params.memory,
        thread: threadId,
        resource: RESOURCE_ID,
      },
    },
  })
  return createUIMessageStreamResponse({
    stream: stream as ReadableStream<UIMessageChunk>,
  })
}

export async function GET(req: Request) {
  const threadId = new URL(req.url).searchParams.get('threadId')

  if (!threadId) {
    return NextResponse.json({ error: 'threadId is required' }, { status: 400 })
  }

  const memory = await mastra.getAgentById('weather-agent').getMemory()
  let response = null

  try {
    response = await memory?.recall({
      threadId,
      resourceId: RESOURCE_ID,
    })
  } catch {
    console.log('No previous messages found.')
  }

  const uiMessages = toAISdkV5Messages(response?.messages || [])

  return NextResponse.json(uiMessages)
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing `src/app/api/chat/route.ts`.

- [ ] **Step 3: Manual verification**

With the dev server running and Ollama up, create a thread and send a message directly:
```bash
THREAD_ID=$(curl -s -X POST http://localhost:3000/api/threads | node -e "process.stdin.on('data', d => process.stdout.write(JSON.parse(d).id))")
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d "{\"threadId\":\"$THREAD_ID\",\"messages\":[{\"id\":\"m1\",\"role\":\"user\",\"parts\":[{\"type\":\"text\",\"text\":\"Weather in Tokyo\"}]}]}" \
  > /dev/null
curl -s http://localhost:3000/api/threads
```
Expected: the thread list shows the thread from `$THREAD_ID` now titled `Weather in Tokyo` (auto-titled from the first message).

Then:
```bash
curl -s "http://localhost:3000/api/chat?threadId=$THREAD_ID"
```
Expected: JSON array of UI messages including the user's "Weather in Tokyo" message and the assistant's reply.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat: scope /api/chat to a request-provided threadId and auto-title threads"
```

---

### Task 4: `ChatSidebar` component

**Files:**
- Create: `src/components/chat-sidebar.tsx`

**Interfaces:**
- Consumes: `GET /api/threads`, `POST /api/threads`, `DELETE /api/threads/:id` (Tasks 1–2).
- Produces: `ChatSidebar` React component with props:
  ```ts
  type ChatSidebarProps = {
    activeThreadId: string | null
    onSelectThread: (threadId: string) => void
    onNewThread: (threadId: string) => void
    onThreadDeleted: (threadId: string) => void
  }
  ```
  Task 5's page consumes this component and these exact prop names/types.

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { MessageSquareIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ThreadSummary = {
  id: string
  title: string | null
  createdAt: string
  updatedAt: string
}

type ChatSidebarProps = {
  activeThreadId: string | null
  onSelectThread: (threadId: string) => void
  onNewThread: (threadId: string) => void
  onThreadDeleted: (threadId: string) => void
}

export function ChatSidebar({ activeThreadId, onSelectThread, onNewThread, onThreadDeleted }: ChatSidebarProps) {
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    const res = await fetch('/api/threads')
    const data: ThreadSummary[] = await res.json()
    setThreads(data)
    setLoading(false)
  }

  useEffect(() => {
    refresh()
  }, [])

  const handleNewThread = async () => {
    const res = await fetch('/api/threads', { method: 'POST' })
    const thread: ThreadSummary = await res.json()
    setThreads(prev => [thread, ...prev])
    onNewThread(thread.id)
  }

  const handleDelete = async (threadId: string) => {
    await fetch(`/api/threads/${threadId}`, { method: 'DELETE' })
    setThreads(prev => prev.filter(thread => thread.id !== threadId))
    onThreadDeleted(threadId)
  }

  return (
    <div className="flex w-64 shrink-0 flex-col border-r bg-muted/30">
      <div className="p-3">
        <Button variant="outline" className="w-full justify-start" onClick={handleNewThread}>
          <PlusIcon />
          New Chat
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {loading && <p className="px-2 py-1 text-muted-foreground text-xs">Loading…</p>}

        {!loading && threads.length === 0 && (
          <p className="px-2 py-1 text-muted-foreground text-xs">No conversations yet.</p>
        )}

        {threads.map(thread => (
          <div
            key={thread.id}
            className={cn(
              'group flex items-center gap-2 rounded-lg px-2 py-2 text-sm cursor-pointer',
              thread.id === activeThreadId ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60',
            )}
            onClick={() => onSelectThread(thread.id)}
          >
            <MessageSquareIcon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{thread.title ?? 'New chat'}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 opacity-0 group-hover:opacity-100"
              onClick={e => {
                e.stopPropagation()
                handleDelete(thread.id)
              }}
            >
              <Trash2Icon />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing `src/components/chat-sidebar.tsx`.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no new errors/warnings from `chat-sidebar.tsx`.

(This component isn't wired into any page yet — full behavioral verification happens in Task 5.)

- [ ] **Step 4: Commit**

```bash
git add src/components/chat-sidebar.tsx
git commit -m "feat: add ChatSidebar component for thread list/new/delete"
```

---

### Task 5: Wire the sidebar into `chat/page.tsx`

**Files:**
- Modify: `src/app/chat/page.tsx`

**Interfaces:**
- Consumes: `ChatSidebar` from Task 4 (props `activeThreadId`, `onSelectThread`, `onNewThread`, `onThreadDeleted`); `/api/chat` from Task 3 (now requires `threadId` in the `POST` body and `GET` query string).
- Produces: default export `Chat` page component (unchanged export shape — still the default export of `chat/page.tsx`).

- [ ] **Step 1: Replace the file contents**

```tsx
'use client'

import '@/app/globals.css'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { DefaultChatTransport, ToolUIPart } from 'ai'
import { useChat } from '@ai-sdk/react'
import { BotIcon, CloudSunIcon, UserIcon } from 'lucide-react'

import { ChatSidebar } from '@/components/chat-sidebar'

import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input'

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'

import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'

import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from '@/components/ai-elements/tool'

import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion'

const SUGGESTIONS = ['Weather in Tokyo', 'Weather in Paris', 'Weather in Berlin']

function ChatPanel({ threadId }: { threadId: string }) {
  const [input, setInput] = useState<string>('')

  const { messages, setMessages, sendMessage, status, stop } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: { threadId },
    }),
  })

  useEffect(() => {
    const fetchMessages = async () => {
      const res = await fetch(`/api/chat?threadId=${threadId}`)
      const data = await res.json()
      setMessages([...data])
    }
    fetchMessages()
  }, [setMessages, threadId])

  const handleSubmit = async () => {
    if (!input.trim()) return

    sendMessage({ text: input })
    setInput('')
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden px-4">
      <Conversation className="h-full">
        <ConversationContent>
          {messages.length === 0 && (
            <ConversationEmptyState>
              <div className="flex flex-col items-center gap-3">
                <div className="text-muted-foreground">
                  <CloudSunIcon className="size-8" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-medium text-sm">What&apos;s the weather like?</h3>
                  <p className="text-muted-foreground text-sm">
                    Ask about current conditions in any city and get activity ideas to match.
                  </p>
                </div>
                <Suggestions>
                  {SUGGESTIONS.map(suggestion => (
                    <Suggestion
                      key={suggestion}
                      suggestion={suggestion}
                      onClick={text => sendMessage({ text: `What's the weather in ${text.replace('Weather in ', '')}?` })}
                    />
                  ))}
                </Suggestions>
              </div>
            </ConversationEmptyState>
          )}

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
                {message.parts?.map((part, i) => {
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
                          <ToolOutput
                            output={(part as ToolUIPart).output}
                            errorText={(part as ToolUIPart).errorText}
                          />
                        </ToolContent>
                      </Tool>
                    )
                  }

                  return null
                })}
              </div>
            </div>
          ))}
          <ConversationScrollButton />
        </ConversationContent>
      </Conversation>

      <PromptInput onSubmit={handleSubmit} className="sticky bottom-0 border-t bg-background pt-4 pb-6">
        <PromptInputBody>
          <PromptInputTextarea
            onChange={e => setInput(e.target.value)}
            className="md:leading-10"
            value={input}
            placeholder="Type your message..."
            disabled={status !== 'ready'}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools />
          <PromptInputSubmit status={status} onStop={stop} disabled={status === 'ready' && !input.trim()} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}

function Chat() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activeThreadId, setActiveThreadId] = useState<string | null>(searchParams.get('thread'))

  const selectThread = (threadId: string) => {
    setActiveThreadId(threadId)
    router.replace(`/chat?thread=${threadId}`)
  }

  const handleThreadDeleted = (threadId: string) => {
    if (threadId === activeThreadId) {
      setActiveThreadId(null)
      router.replace('/chat')
    }
  }

  return (
    <div className="flex h-screen w-full bg-background">
      <ChatSidebar
        activeThreadId={activeThreadId}
        onSelectThread={selectThread}
        onNewThread={selectThread}
        onThreadDeleted={handleThreadDeleted}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-2 border-b px-6 py-4">
          <div className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <CloudSunIcon className="size-4" />
          </div>
          <div>
            <h1 className="font-semibold text-sm">Weather Assistant</h1>
            <p className="text-muted-foreground text-xs">Ask about the weather anywhere</p>
          </div>
        </header>

        {activeThreadId ? (
          <ChatPanel key={activeThreadId} threadId={activeThreadId} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <CloudSunIcon className="size-8 text-muted-foreground" />
              <p className="text-muted-foreground text-sm">Start a new chat to ask about the weather.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default Chat
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing `src/app/chat/page.tsx`.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no new errors/warnings from `chat/page.tsx`.

- [ ] **Step 4: Manual browser verification**

With `pnpm dev` running and Ollama up, open `http://localhost:3000/chat`:
1. Confirm the empty state ("Start a new chat…") shows and the sidebar shows "No conversations yet."
2. Click "New Chat" — an empty chat panel appears, URL becomes `/chat?thread=<id>`.
3. Send "Weather in Tokyo" — confirm a reply streams in, and the sidebar entry for this thread updates its title to "Weather in Tokyo" (may need the list to refresh — clicking "New Chat" again or reloading the page shows it).
4. Click "New Chat" again, send a different message in the second thread.
5. Click back to the first thread in the sidebar — confirm its original messages (Tokyo weather) reload correctly, not the second thread's.
6. Reload the browser page while the second thread's URL is active — confirm its history still loads via the `?thread=` param.
7. Hover a thread row and click the trash icon — confirm it disappears from the sidebar; if it was the active thread, confirm the panel returns to the empty state.

- [ ] **Step 5: Commit**

```bash
git add src/app/chat/page.tsx
git commit -m "feat: wire ChatSidebar into chat page with per-thread routing"
```
