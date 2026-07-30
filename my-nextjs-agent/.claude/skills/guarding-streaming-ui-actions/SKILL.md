---
name: guarding-streaming-ui-actions
description: Use when wiring a button or action inside AI SDK (useChat) rendered tool-result UI — e.g. a card's "Add"/"Remove" button — that calls sendMessage or another mutation, before shipping it.
---

# Guarding Streaming UI Actions

## Overview

A tool-result card (rendered from `message.parts`) can be clicked while a
response is still streaming. Calling `sendMessage` at that moment queues a
duplicate/conflicting turn on top of the one in flight — `useChat`'s `status`
exists specifically to detect this window, and both places that read it must
be updated: the handler, and the component that renders the button.

## When to Use

- A rendered tool-result part (`case "tool-x":` in the `message.parts` switch)
  includes an interactive control (button, select, form) that triggers
  `sendMessage`, `append`, or any other mutation.

## Core Pattern

```tsx
const { sendMessage, status } = useChat(/* ... */);

const handleAddFilm = (title: string) => {
  if (status !== "ready") return;        // functional guard: don't fire mid-stream
  sendMessage({ text: `Add ${title} to my watchlist` });
};

// ...
case "tool-ghibliFilms":
  if (part.state === "output-available") {
    return (
      <FilmGridCard
        films={part.output}
        onAdd={handleAddFilm}
        disabled={status !== "ready"}    // visual guard: passed through to the card
      />
    );
  }
```

Both guards are required:

- The **early return** in the handler stops the action even if the click
  somehow still fires (e.g. a keyboard trigger, a stale closure).
- The **`disabled` prop**, threaded down into the rendered card's actual
  button, stops the user from clicking (and re-clicking) in the first place —
  without it the button looks live during a stream and users click multiple
  times, queuing multiple turns once the stream ends.

## Quick Reference

| Symptom | Fix |
|---|---|
| Button in a tool-result card fires `sendMessage` with no `status` check | Add `if (status !== "ready") return;` at the top of the handler |
| Button stays visually enabled while a response streams | Add a `disabled?: boolean` prop to the card component and pass `status !== "ready"` |
| Card component takes `disabled` but doesn't apply it to the actual `<button>` | Wire the prop through to the element, not just accept it in the type |

## Common Mistakes

- Adding the early-return guard but forgetting the `disabled` prop (or vice
  versa) — one without the other still lets a user double-click before the
  guard has anything to stop.
- Assuming a fresh render of the tool part means the *previous* call
  finished — `status` reflects the whole chat stream, not the individual
  part; check `status`, not the part's own state.
