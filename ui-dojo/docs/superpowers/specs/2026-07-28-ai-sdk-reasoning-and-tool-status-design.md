# AI SDK Ghibli Demo — Reasoning & Tool-Call Status UI

## Problem

On [src/pages/ai-sdk/index.tsx](../../../src/pages/ai-sdk/index.tsx), a message round-trip shows no feedback while the agent is working:

1. **Reasoning never renders.** The page already contains `Reasoning` / `ReasoningTrigger` / `ReasoningContent` (ai-elements) and computes `reasoningText` via `getVisibleReasoningText`, but `ghibliAgent` ([src/mastra/agents/ghibli-agent.ts](../../../src/mastra/agents/ghibli-agent.ts)) runs `google/gemini-3.5-flash` with no thinking configuration, so the model never streams `reasoning` parts. The UI is dead code in practice.
2. **Tool calls are silent.** The `message.parts` switch only handles `tool-show_watchlist`. `ghibliFilms` and `ghibliCharacters` — the two tools used on almost every question — fall into `default: return null`. Between the initial `status === "submitted"` spinner (which disappears as soon as any part starts streaming) and the final text answer, the user sees nothing.

## Goals

- Make Gemini's thinking output visible through the existing Reasoning UI, with no frontend changes required for that part.
- Give `ghibliFilms` / `ghibliCharacters` tool calls the same kind of in-flight and error feedback `show_watchlist` already has, without building a new result-card UI for them (their result is the following text answer, not a card).

## Non-goals

- No changes to other pages/agents (CopilotKit, Assistant UI, other AI SDK demos).
- No new shared "tool status" component — this is a two-tool, one-page fix, matching the existing inline-switch style already used in this file.
- No change to `useChat`/transport/routes; `sendReasoning: true` is already set on `chatRoute` in [src/mastra/index.ts](../../../src/mastra/index.ts).

## Design

### 1. Enable Gemini thinking (backend)

In `ghibliAgent`, add:

```ts
defaultOptions: {
  maxSteps: 20,
  providerOptions: {
    google: {
      thinkingConfig: { includeThoughts: true, thinkingBudget: -1 },
    },
  },
},
```

- `includeThoughts: true` makes the Google provider surface thought summaries as `reasoning` parts (mirrors how `ck_reasoning` uses `reasoningSummary: "detailed"` for OpenAI — same intent, different provider's knob).
- `thinkingBudget: -1` uses Gemini's dynamic budget (model decides how much to think) rather than a fixed token cap.
- No frontend change needed: the existing `reasoningText` / `isReasoningStreaming` / `Reasoning` block in `ChatView` already does the right thing once parts of type `reasoning` exist.

### 2. Tool-call status for `ghibliFilms` / `ghibliCharacters` (frontend)

In the `message.parts.map` switch in `ChatView` ([src/pages/ai-sdk/index.tsx](../../../src/pages/ai-sdk/index.tsx)), add two cases following the existing `tool-show_watchlist` shape:

```tsx
case "tool-ghibliFilms":
case "tool-ghibliCharacters":
  switch (part.state) {
    case "input-available":
      return (
        <div key={`${message.id}-${i}`} className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader size={14} />
          {part.type === "tool-ghibliFilms" ? "Looking up films…" : "Looking up characters…"}
        </div>
      );
    case "output-error":
      return (
        <div key={`${message.id}-${i}`} className="text-destructive text-sm">
          Error: {part.errorText}
        </div>
      );
    default:
      return null;
  }
```

- `output-available` stays `default: null` — no card is needed, the agent's following text part is the visible result.
- Label text is per-tool (per the approved option), not a single generic "Loading…" string.

## Testing

No test suite exists in this repo (per project CLAUDE.md). Manual verification:

- `pnpm run dev`, open the AI SDK Ghibli demo, ask "Tell me about Spirited Away" → expect a "Looking up films…" row while `ghibliFilms` runs, then a Reasoning block (collapsed, expandable) before/alongside the final answer.
- Ask a characters question → expect "Looking up characters…" row.
- Trigger a tool error (e.g., temporarily break a tool) → expect the red error line instead of a silent gap.
- `pnpm run vite:build` to confirm typecheck passes.
