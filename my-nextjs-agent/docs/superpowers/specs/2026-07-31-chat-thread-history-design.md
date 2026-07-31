# Design: Multi-thread chat with a message history sidebar

## Purpose

`src/app/api/chat/route.ts` currently hardcodes `THREAD_ID = 'example-user-id'`
— every message anyone sends goes into the same single Mastra memory thread,
and there's no way to start a fresh conversation or revisit a past one. This
adds a proper example of Mastra's thread-based message history: a sidebar
listing past conversations, a "New Chat" action, and per-thread isolation,
while keeping `RESOURCE_ID` hardcoded since this app has no auth.

## Mechanism

Mastra's `Memory` class already exposes everything needed for thread CRUD:

- `memory.listThreads({ filter: { resourceId }, orderBy })` — paginated thread
  list, filterable by resource.
- `memory.createThread({ resourceId })` — creates a thread, optionally with a
  `title`.
- `memory.updateThread({ id, title })` — renames a thread.
- `memory.deleteThread({ threadId })` — deletes a thread (and its vectors, if
  any).

No storage changes are needed — this reuses the existing `LibSQLStore` wiring
in `src/mastra/index.ts`.

Thread titles are derived from the first user message (truncated to ~40
chars) rather than an LLM call, to keep the example free of extra model
round-trips. `Memory` does support a built-in `generateTitle` LLM option, but
that's out of scope here.

## Changes

### 1. `src/app/api/threads/route.ts` (new)

- `GET` — resolves `weatherAgent`'s `Memory` instance, calls
  `memory.listThreads({ filter: { resourceId: RESOURCE_ID }, orderBy: { field: 'updatedAt', direction: 'DESC' }, perPage: false })`,
  returns the thread list as JSON (`id`, `title`, `createdAt`, `updatedAt`).
- `POST` — calls `memory.createThread({ resourceId: RESOURCE_ID })` (no title
  yet — set on first message, see below), returns the created thread.

### 2. `src/app/api/threads/[threadId]/route.ts` (new)

- `DELETE` — calls `memory.deleteThread({ threadId })`.

### 3. `src/app/api/chat/route.ts` (modified)

- Remove the hardcoded `THREAD_ID` constant; `RESOURCE_ID` stays.
- `POST`: read `threadId` from the request body (the client now sends it via
  `DefaultChatTransport`'s `body` option) and use it as `memory.thread`
  instead of the old constant. Before streaming the response, fetch the
  thread via `memory.getThreadById({ threadId })`; if it has no title yet,
  find the latest `role: 'user'` entry in `params.messages`, extract its text,
  truncate to ~40 chars, and call `memory.updateThread({ id: threadId, title })`.
  This runs once per thread, on its first message.
- `GET`: read `threadId` from a `?threadId=` query param instead of the
  hardcoded constant; 400 if missing.

### 4. `src/components/chat-sidebar.tsx` (new)

Client component. Props: `activeThreadId`, `onSelectThread(id)`,
`onNewThread()`. On mount (and after create/delete), fetches
`GET /api/threads` and renders:

- A "New Chat" button calling `onNewThread`.
- A list of threads (title, relative timestamp), the active one highlighted,
  each with a delete icon button that calls `DELETE /api/threads/:id` then
  re-fetches the list (and clears selection via `onNewThread`-style callback
  if the deleted thread was active).

### 5. `src/app/chat/page.tsx` (restructured)

- Becomes a container: holds `activeThreadId` state, synced to a `?thread=`
  URL query param (via `useSearchParams` / `router.replace`) so a thread is
  shareable/survives refresh.
- Renders `<ChatSidebar>` alongside the chat panel.
- The existing chat UI (the current contents of `Chat()`) moves into a
  `ChatPanel({ threadId })` component, **keyed by `threadId`** so switching
  threads fully remounts `useChat` instead of carrying over stale state.
- `DefaultChatTransport` gains `body: { threadId }` so it's included on every
  `sendMessage` call; the history-hydration `GET` call becomes
  `fetch('/api/chat?threadId=' + threadId)`.
- When `activeThreadId` is `null` (initial load, or after deleting the active
  thread), the main panel shows an empty state with its own "New Chat" CTA
  instead of rendering `ChatPanel` — no thread is auto-created on page load.
- "New Chat": `POST /api/threads` → set the returned id as active → URL
  updates → panel remounts empty.

## Out of scope

- Auth / per-user `resourceId` — stays hardcoded as `'weather-chat'`.
- LLM-generated titles (`generateTitle` option).
- Thread renaming from the UI (only auto-title-on-first-message).
- Any change to `weatherAgent`'s tools, instructions, or working-memory setup.

## Testing

Manual: start the app (`pnpm dev`, Ollama running). Confirm: sidebar loads
empty state → "New Chat" creates a thread and shows an empty panel → sending
a message titles the thread in the sidebar with the truncated text →
switching to a second new thread keeps the first thread's messages intact →
reload the page and the previously active thread (via `?thread=`) still
loads its history → deleting a thread removes it from the sidebar and, if it
was active, returns to the empty state.
