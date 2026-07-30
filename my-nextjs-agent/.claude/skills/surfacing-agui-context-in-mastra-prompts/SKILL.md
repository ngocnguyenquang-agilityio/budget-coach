---
name: surfacing-agui-context-in-mastra-prompts
description: Use when a Mastra agent behind AG-UI/CopilotKit needs to see frontend state pushed via useAgentContext (or other AG-UI RunAgentInput.context), and the agent's answers don't reflect that state even though the frontend appears to be sending it.
---

# Surfacing AG-UI Context in Mastra Prompts

## Overview

CopilotKit's `useAgentContext({ description, value })` sends `{description,
value}` pairs over AG-UI's `RunAgentInput.context`. `@ag-ui/mastra` parks that
array on Mastra's `requestContext` under the **`"ag-ui"`** key — it does
**not** inject it into the prompt automatically. Mastra's `requestContext` is
a plain data bag; nothing reads well-known keys on its own. If the agent's
`instructions` is a static string, the context is silently unused no matter
how correctly the frontend pushes it.

## When to Use

- An agent needs to answer questions about live frontend state (theme,
  selected item, pinned list, current page) pushed via `useAgentContext`.
- Symptom: the frontend hook is wired correctly, but the agent says it
  doesn't know the value, or answers from stale/default assumptions.

## Core Pattern

```ts
export const ckAgent = new Agent({
  id: "ck_agent",
  name: "ck_agent",
  instructions: async ({ requestContext }) => {
    const agui = requestContext?.get("ag-ui") as
      | { context?: Array<{ description: string; value: string }> }
      | undefined;
    const items = agui?.context ?? [];
    if (items.length === 0) return BASE_INSTRUCTIONS;

    const contextBlock = items
      .map(({ description, value }) => `- ${description}: ${value}`)
      .join("\n");
    return `${BASE_INSTRUCTIONS}\n\nCurrent client-side context:\n${contextBlock}`;
  },
  model,
});
```

`instructions` must be a function (`DynamicArgument`) reading
`requestContext`, not a static string — that's the only place per-request
context can be pulled in.

## Quick Reference

| Symptom | Fix |
|---|---|
| Agent never mentions context that `useAgentContext` is clearly sending | `instructions` is a static string — convert to a function reading `requestContext` |
| Reading `requestContext.get("context")` (or another guessed key) returns `undefined` | The `@ag-ui/mastra` bridge uses the key **`"ag-ui"`**, not `"context"` — read `requestContext.get("ag-ui").context` |
| Prompt shows `"Current client-side context:\n"` with nothing after it | Missing the empty-array fallback — return `BASE_INSTRUCTIONS` unchanged when `items.length === 0` instead of always appending the block |
| Multiple `useAgentContext` calls on the page, only one shows up | Check they aren't overwriting the same context key/description — each call's pair is appended, but duplicate descriptions can shadow each other depending on the adapter version |

## Common Mistakes

- Guessing the `requestContext` key name instead of verifying it — `"ag-ui"`
  is specific to the `@ag-ui/mastra` adapter and isn't documented next to
  `useAgentContext` itself, so it's easy to assume a more "obvious" key like
  `"context"`.
- Forgetting the empty-context fallback, which produces a prompt with a
  dangling "Current client-side context:" header before any context ever
  exists (e.g. on the very first render before the hook fires).
