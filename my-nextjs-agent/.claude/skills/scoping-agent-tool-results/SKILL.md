---
name: scoping-agent-tool-results
description: Use when designing or extending an agent tool that wraps a list-returning API or dataset, before deciding what filter parameters the tool exposes and what the agent's instructions say about using them.
---

# Scoping Agent Tool Results

## Overview

A tool that *can* return everything, *will* return everything the moment a
user's phrasing doesn't map onto one of its filter params. The model has no
partial-filter option — if nothing matches, it omits the filter and gets the
full dataset dumped into context. Fix the tool and the instructions together;
neither alone is sufficient.

## When to Use

- Adding or reviewing a tool (`createTool`, REST wrapper, DB query helper)
  that fetches a list/collection.
- A user question is naturally scoped to one entity or one relationship, but
  the tool's only filter is a different field.

## Core Pattern

1. **Enumerate concrete example questions first**, including *relational*
   ones — "characters in film X", "orders for customer Y", "comments on post
   Z" — not just "the one with this exact name". Relational scoping is the
   case that gets missed: the filter value (film title) isn't a field on the
   objects the tool returns per-item (character), so it requires resolving
   through a second lookup or a join, not a simple `.filter()` on the return
   type.
2. **Add one filter param per question shape**, not per field that happens to
   exist on the object. If "characters in a film" is a real question, add a
   `film` param even though `film` isn't a top-level field of a character —
   resolve it (e.g. look up the film, then filter people whose `films` array
   references it).
3. **Write instructions as phrasing → filter pairs**, not a general rule.
   "Pass the filter when the question is about one item" is too vague to
   disambiguate `name` vs `film` when both exist. Spell out: *"For 'characters
   in <film>' questions, pass `film` — not `name`, the character names aren't
   known up front."*

## Quick Reference

| Symptom | Fix |
|---|---|
| Tool has no filter matching a common relational question | Add a filter for the relationship, resolved via a lookup if needed — don't rely on the model to fetch-all-then-reason |
| Instructions say "use the filter for specific questions" | Replace with explicit phrasing → filter/field examples, especially when multiple filters could plausibly apply |
| "List all" / "how many" questions still return full item bodies | Return summaries + a count field (`total`) for unfiltered/list queries; only return full detail for a single resolved match |
| Multiple matches for a name-style filter | Return summaries + a `note` telling the agent to disambiguate, not the full detail for every match |

## Common Mistakes

- **Filtering only on fields visible on the returned object.** A tool for
  "characters" naturally gets a `name` filter because `name` is a field on
  a character — but "characters in film X" needs `film`, which requires a
  separate resolution step, and is easy to skip because it's not "on" the
  object being filtered.
- **Vague instructions.** "Pass a filter for specific questions" leaves the
  model to guess which of two overlapping filters (`name` vs `film`) applies;
  give literal example phrasings mapped to the exact param.
