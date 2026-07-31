# Destination Guide RAG for Trip Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Retrieval-Augmented Generation (RAG) knowledge base of destination guides (5 hardcoded cities, seeded from Wikivoyage) that `tripPlannerAgent` can query via a new `searchDestinationGuideTool`, grounding itineraries in curated guide content instead of the model's raw knowledge alone.

**Architecture:** A one-off script (`pnpm seed:guides`) fetches Wikivoyage article extracts for 5 cities, chunks them with `@mastra/rag`'s `MDocument`, embeds each chunk with a local Ollama embedding model (`nomic-embed-text`), and stores them in a `LibSQLVector` index (`destination_guides`) inside the existing `mastra.db` file. At chat time, a new tool embeds the agent's query and does a similarity search filtered to the requested city, returning matched chunk texts (or an empty array, which the agent is instructed to treat as "no guide available, use general knowledge").

**Tech Stack:** `@mastra/rag` (`MDocument`, chunking), `@mastra/libsql` (`LibSQLVector`), `ai` (`embed`/`embedMany` against an Ollama `textEmbeddingModel`), `tsx` (to run the seed script directly from TypeScript source, since this repo has no other script runner).

**No test runner is configured in this project** (confirmed in `.claude/CLAUDE.md`), so this plan uses `pnpm lint` after each code change plus manual verification (running the seed script, querying the tool directly, and exercising the trip planner in the chat UI) — the same style used by the existing `2026-07-31-trip-planner-agent.md` plan.

**Per explicit user instruction: no `git commit` steps are included anywhere in this plan.** Do not commit as part of executing it. Leave changes staged/unstaged for the user to commit themselves.

## Deviations from / refinements to the approved spec

The spec (`docs/superpowers/specs/2026-07-31-destination-guide-rag-design.md`) left several implementation details open for the implementer to confirm against the real API before finalizing. Those have now been confirmed directly (by installing `@mastra/rag`/`@mastra/libsql` in a scratch check and reading their type definitions and a live test against a file-backed `LibSQLVector`), which lets this plan be concrete rather than hedged:

1. **Tool shape (spec Backend §5, option (a) vs (b)):** confirmed `createVectorQueryTool`'s `filter` field is an LLM-authored string (only added to the schema when `enableFilter: true`), not a hard per-call binding — it cannot guarantee "never leak another city's content." This plan uses **option (b)**: a plain `createTool` whose `execute` calls `LibSQLVector.query()` directly with an explicit `filter: { city }`, so scoping is enforced in code, not left to the model.
2. **Idempotent re-seeding (spec Backend §4):** confirmed `LibSQLVector.deleteVectors({ indexName, filter })` deletes directly by metadata filter. The spec's fallback plan (deterministic ids + manifest file) is **not needed** — re-seeding a city is simply `deleteVectors({ filter: { city } })` followed by `upsert(...)`.
3. **Embedding dimension (spec Backend §2):** `nomic-embed-text` produces 768-dimensional embeddings (its documented/standard output size). `LibSQLVector.createIndex` is called once with `dimension: 768`; a real mismatch would surface immediately as an upsert error in Task 5's verification step.
4. **Chunk option names:** `@mastra/rag`'s chunk options are `maxSize`/`overlap` (not `chunkSize`) — used directly below.
5. **New refinement not in the spec — capping article length:** live Wikivoyage extracts for the 5 target cities run 68,000–176,000 characters. Chunked at ~512 characters that's 130–350+ chunks per city, meaning 700+ local embedding calls for a full seed run — slow and unnecessary for a demo knowledge base. The seed script truncates each extract to its first `MAX_EXTRACT_CHARS = 8000` characters before chunking (roughly the "Understand"/"Get in"/"See"/"Do" intro sections, which are the most itinerary-relevant), cutting this to ~15–20 chunks per city. This is a pragmatic scope decision, not a correctness fix; it's called out here rather than silently added.

---

### Task 1: Add dependencies and the seed script's `pnpm` entry

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install `@mastra/rag` and `tsx`**

Run:

```bash
pnpm add @mastra/rag
pnpm add -D tsx
```

`@mastra/rag` provides `MDocument` (chunking) used in Task 4 and Task 6's investigation. `tsx` runs the seed script's TypeScript source directly — this repo has no existing script runner (no `ts-node`, and `"type": "module"` isn't set, so plain `node` can't run the `import`/`export` syntax used everywhere else in this codebase).

- [ ] **Step 2: Add the `seed:guides` script**

In `package.json`, add to `"scripts"` (alongside `dev`/`build`/`start`/`lint`):

```json
    "seed:guides": "tsx scripts/seed-destination-guides.ts"
```

- [ ] **Step 3: Verify**

Run: `pnpm seed:guides`
Expected: fails with a module-not-found error for `./scripts/seed-destination-guides.ts` (it doesn't exist yet — Task 4 creates it). This just confirms `tsx` itself runs.

---

### Task 2: Add the shared Ollama embedding model

**Files:**
- Modify: `src/mastra/model.ts`

- [ ] **Step 1: Add the embedding model export**

In `src/mastra/model.ts`, change:

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export const ollama = createOpenAICompatible({
  name: 'ollama',
  baseURL: 'http://localhost:11434/v1',
});
```

to:

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export const ollama = createOpenAICompatible({
  name: 'ollama',
  baseURL: 'http://localhost:11434/v1',
});

export const ollamaEmbedding = ollama.textEmbeddingModel('nomic-embed-text');
```

- [ ] **Step 2: Verify**

Run: `pnpm lint`
Expected: no errors.

---

### Task 3: Create the shared vector store module

**Files:**
- Create: `src/mastra/vector-store.ts`

- [ ] **Step 1: Write the module**

Create `src/mastra/vector-store.ts`:

```ts
import { LibSQLVector } from '@mastra/libsql';

export const DESTINATION_GUIDES_INDEX = 'destination_guides';

// nomic-embed-text's embedding output size — must match whatever's
// actually pulled via `ollama pull nomic-embed-text`.
export const DESTINATION_GUIDES_DIMENSION = 768;

export const destinationGuidesVector = new LibSQLVector({
  id: 'destination-guides-vector',
  // Same mastra.db file (and same Turso DB when configured) as the rest of
  // the app's storage — a separate table within it, not a separate file.
  url: process.env.TURSO_DATABASE_URL ?? 'file:./mastra.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});
```

This mirrors how `src/mastra/index.ts` configures its `LibSQLStore` (same env var fallback pattern). Both the seed script (Task 4) and the runtime tool (Task 6) import `destinationGuidesVector`/`DESTINATION_GUIDES_INDEX` from here rather than constructing their own instances.

- [ ] **Step 2: Verify**

Run: `pnpm lint`
Expected: no errors.

---

### Task 4: Create the seed script

**Files:**
- Create: `scripts/seed-destination-guides.ts`

- [ ] **Step 1: Write the script**

Create `scripts/seed-destination-guides.ts`:

```ts
import { MDocument } from '@mastra/rag';
import { embedMany } from 'ai';
import { ollamaEmbedding } from '../src/mastra/model';
import {
  destinationGuidesVector,
  DESTINATION_GUIDES_INDEX,
  DESTINATION_GUIDES_DIMENSION,
} from '../src/mastra/vector-store';

const CITIES: { city: string; wikivoyageTitle: string }[] = [
  { city: 'Lisbon', wikivoyageTitle: 'Lisbon' },
  { city: 'Tokyo', wikivoyageTitle: 'Tokyo' },
  { city: 'Paris', wikivoyageTitle: 'Paris' },
  { city: 'Bangkok', wikivoyageTitle: 'Bangkok' },
  { city: 'New York', wikivoyageTitle: 'New York City' },
];

// Wikivoyage articles run 60k-180k characters; truncating keeps seeding
// fast (a handful of chunks per city instead of hundreds) while keeping
// the most itinerary-relevant intro/overview sections.
const MAX_EXTRACT_CHARS = 8000;

async function fetchWikivoyageExtract(title: string): Promise<string | null> {
  const url = `https://en.wikivoyage.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json&titles=${encodeURIComponent(title)}`;
  const response = await fetch(url);
  if (!response.ok) return null;

  const data = (await response.json()) as {
    query: { pages: Record<string, { extract?: string }> };
  };
  const extract = Object.values(data.query.pages)[0]?.extract;
  return extract && extract.trim().length > 0 ? extract.slice(0, MAX_EXTRACT_CHARS) : null;
}

async function seedCity(city: string, wikivoyageTitle: string) {
  const extract = await fetchWikivoyageExtract(wikivoyageTitle);
  if (!extract) {
    console.warn(`[seed:guides] Skipping "${city}" — no Wikivoyage extract for "${wikivoyageTitle}"`);
    return;
  }

  const chunks = await MDocument.fromText(extract).chunk({
    strategy: 'recursive',
    maxSize: 512,
    overlap: 50,
  });

  const { embeddings } = await embedMany({
    model: ollamaEmbedding,
    values: chunks.map(chunk => chunk.text),
  });

  // Idempotent re-seed: clear this city's existing vectors before inserting
  // the fresh set, so re-running the script doesn't duplicate entries.
  await destinationGuidesVector.deleteVectors({
    indexName: DESTINATION_GUIDES_INDEX,
    filter: { city },
  });

  await destinationGuidesVector.upsert({
    indexName: DESTINATION_GUIDES_INDEX,
    vectors: embeddings,
    metadata: chunks.map(chunk => ({ city, source: 'wikivoyage', text: chunk.text })),
  });

  console.log(`[seed:guides] Seeded "${city}" — ${chunks.length} chunks`);
}

async function main() {
  await destinationGuidesVector.createIndex({
    indexName: DESTINATION_GUIDES_INDEX,
    dimension: DESTINATION_GUIDES_DIMENSION,
  });

  for (const { city, wikivoyageTitle } of CITIES) {
    await seedCity(city, wikivoyageTitle);
  }
}

main()
  .then(() => {
    console.log('[seed:guides] Done.');
    process.exit(0);
  })
  .catch(error => {
    console.error('[seed:guides] Failed:', error);
    process.exit(1);
  });
```

Notes on choices already made here (so there's nothing left to decide mid-implementation):
- `createIndex` is called unconditionally on every run — confirmed safe to call repeatedly (it's a no-op / `CREATE TABLE IF NOT EXISTS`-style operation, verified directly against `@mastra/libsql`, not assumed).
- Chunk metadata includes the chunk's own `text` (`{ city, source: 'wikivoyage', text: chunk.text }`) because `LibSQLVector.query()` results return `metadata`, not the original chunk object — the tool in Task 6 reads guide text back out of `metadata.text`.
- Per-city fetch failures (`fetchWikivoyageExtract` returning `null`) are logged and skipped, not fatal — matches the spec's error-handling requirement. An unreachable Ollama server surfaces as an uncaught rejection from `embedMany`, which `main().catch(...)` turns into a fatal, clearly-logged exit — also matching the spec.

- [ ] **Step 2: Verify the script's syntax/types**

Run: `pnpm lint`
Expected: no errors. (This only checks types/lint; it doesn't run the script yet — that's Task 5, which has real prerequisites.)

---

### Task 5: Run the seed script and verify the knowledge base

**Files:** none (verification only)

- [ ] **Step 1: Pull the embedding model**

Run: `ollama pull nomic-embed-text`
Expected: download completes (this is a new prerequisite alongside the existing `llama3.1` pull required elsewhere in this project).

- [ ] **Step 2: Run the seed script**

Run: `pnpm seed:guides`
Expected output: one `[seed:guides] Seeded "<city>" — N chunks` line per city (5 total, unless a Wikivoyage fetch fails — in which case a `Skipping` warning appears instead for that city), followed by `[seed:guides] Done.`. If it fails with a dimension-mismatch error, `nomic-embed-text`'s real output size differs from the `768` hardcoded in Task 3 — inspect the error message (it typically states the expected vs. actual dimension) and update `DESTINATION_GUIDES_DIMENSION` in `src/mastra/vector-store.ts` accordingly, then re-run.

- [ ] **Step 3: Sanity-check the index directly**

Run this ad hoc check (not part of the app, just a manual query against the freshly seeded index):

```bash
node -e "
const { LibSQLVector } = require('@mastra/libsql');
(async () => {
  const v = new LibSQLVector({ id: 'check', url: 'file:./mastra.db' });
  const stats = await v.describeIndex({ indexName: 'destination_guides' });
  console.log('index stats:', stats);
})();
"
```

Expected: `count` in the printed stats is greater than 0 (roughly 60-100 total vectors across the 5 cities, given the ~8000-character cap and ~512-character chunks).

- [ ] **Step 4: Re-run idempotency check**

Run: `pnpm seed:guides` a second time, then repeat Step 3's `describeIndex` check.
Expected: the `count` is the same as after the first run (not roughly doubled) — confirms `deleteVectors` + `upsert` is correctly clearing old vectors per city before re-inserting.

---

### Task 6: Create `searchDestinationGuideTool`

**Files:**
- Create: `src/mastra/tools/search-destination-guide-tool.ts`

- [ ] **Step 1: Write the tool**

Create `src/mastra/tools/search-destination-guide-tool.ts`:

```ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { embed } from 'ai';
import { ollamaEmbedding } from '../model';
import { destinationGuidesVector, DESTINATION_GUIDES_INDEX } from '../vector-store';

export const searchDestinationGuideTool = createTool({
  id: 'search-destination-guide',
  description:
    "Search a curated destination guide knowledge base for facts about a specific city (neighborhoods, sights, local tips). Only covers a small, fixed set of cities — an empty result means this city isn't in the knowledge base, which is expected and not an error; fall back to general knowledge in that case.",
  inputSchema: z.object({
    city: z.string().describe('The exact city name to search guide content for, e.g. "Lisbon"'),
    query: z.string().describe('What to look for, e.g. "best neighborhoods for nightlife"'),
  }),
  outputSchema: z.object({
    results: z.array(z.string()),
  }),
  execute: async (inputData) => {
    const { city, query } = inputData;

    try {
      const { embedding } = await embed({ model: ollamaEmbedding, value: query });

      const matches = await destinationGuidesVector.query({
        indexName: DESTINATION_GUIDES_INDEX,
        queryVector: embedding,
        topK: 4,
        filter: { city },
      });

      return { results: matches.map(match => String(match.metadata?.text ?? '')) };
    } catch {
      // Missing index (seed script never run), embedding call failure, etc.
      // all degrade to "no guide content" rather than failing the agent's turn.
      return { results: [] };
    }
  },
});
```

The `filter: { city }` is passed directly to `LibSQLVector.query()`, not left to the model to construct — this is the "option (b)" approach from the "Deviations" section above, so results can never cross-contaminate between cities regardless of what the model does.

- [ ] **Step 2: Verify against the seeded index directly**

With Task 5's seeding already done, run this ad hoc check (isolated from the agent, to confirm the tool logic itself works before wiring it into `tripPlannerAgent`):

```bash
npx tsx -e "
import { searchDestinationGuideTool } from './src/mastra/tools/search-destination-guide-tool';
(async () => {
  const seeded = await searchDestinationGuideTool.execute({ city: 'Lisbon', query: 'best neighborhoods to stay in' });
  console.log('Lisbon (seeded):', seeded.results.length, 'results');
  console.log(seeded.results[0]?.slice(0, 150));

  const unseeded = await searchDestinationGuideTool.execute({ city: 'Nairobi', query: 'best neighborhoods to stay in' });
  console.log('Nairobi (unseeded):', unseeded.results.length, 'results');
})();
"
```

Expected: the Lisbon call returns 1-4 non-empty results (real guide text, not garbage), and the Nairobi call returns exactly 0 results with no thrown error.

If `execute`'s actual call signature differs from `(inputData) => ...` (e.g. it expects `{ context }` instead) in the installed `@mastra/core` version, this step will surface it immediately as a TypeScript/runtime error — adjust to match whatever `createTool`'s types require; `src/mastra/tools/ask-weather-agent-tool.ts` (already shipped and working) is the reference for the correct shape.

---

### Task 7: Wire the tool into `tripPlannerAgent`

**Files:**
- Modify: `src/mastra/agents/trip-planner-agent.ts`

- [ ] **Step 1: Add the import and register the tool**

In `src/mastra/agents/trip-planner-agent.ts`, change:

```ts
import { Agent } from '@mastra/core/agent';
import { ollama } from '../model';
import { askWeatherAgentTool } from '../tools/ask-weather-agent-tool';
```

to:

```ts
import { Agent } from '@mastra/core/agent';
import { ollama } from '../model';
import { askWeatherAgentTool } from '../tools/ask-weather-agent-tool';
import { searchDestinationGuideTool } from '../tools/search-destination-guide-tool';
```

and change:

```ts
  tools: { askWeatherAgentTool },
```

to:

```ts
  tools: { askWeatherAgentTool, searchDestinationGuideTool },
```

- [ ] **Step 2: Extend the instructions**

In the same file, insert a new paragraph into the `instructions` template string, directly after the existing weather-tool paragraph (`"Always call the askWeatherAgentTool tool first, ... before writing anything else."`) and before the `"The tool only reports current weather conditions..."` paragraph:

```
After getting the weather, call the searchDestinationGuideTool with the requested city and a query describing what kind of itinerary content you need (e.g. "neighborhoods and things to do"). This only covers a small set of cities — if it returns no results, that's expected; continue using your own general knowledge and do not mention the lookup or the missing guide to the user. If it does return results, use specific details from them (named neighborhoods, venues, local tips) when writing the itinerary instead of generic filler.
```

- [ ] **Step 3: Verify**

Run: `pnpm lint`
Expected: no errors.

---

### Task 8: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the app**

Ensure a local Ollama server is running with `llama3.1` and `nomic-embed-text` both pulled, then run `pnpm dev` and open `http://localhost:3000/chat`.

- [ ] **Step 2: Verify a seeded city**

Drive the existing trip-planner flow (per `docs/superpowers/plans/2026-07-31-trip-planner-agent.md`'s Task 9): ask about the weather in Lisbon, click "Suggest activities," then "Plan my trip" for 3 days. Confirm the resulting itinerary mentions specific, named details (neighborhoods, venues) that plausibly came from the seeded guide content rather than generic phrasing — cross-check a couple of the named specifics against the `results[0]` text printed in Task 6's Step 2.

- [ ] **Step 3: Verify a non-seeded city**

Repeat with a city not in the 5 seeded ones (e.g. "Nairobi"). Confirm a normal itinerary is still produced, with no errors and no visible caveat/mention of a missing guide.

- [ ] **Step 4: Verify resilience to a missing index**

Temporarily rename `mastra.db` (e.g. `mv mastra.db mastra.db.bak`) to simulate a fresh environment where `pnpm seed:guides` was never run, restart `pnpm dev`, and repeat Step 2's Lisbon flow. Confirm the itinerary still generates successfully (the tool's `catch` returning `{ results: [] }` should make this behave identically to Step 3's non-seeded-city case — no error, no crash). Afterward, stop the dev server, restore the database (`mv mastra.db.bak mastra.db`), and restart.

---

### Task 9: Final build check

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck + production build**

Run: `pnpm build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 2: Final lint pass**

Run: `pnpm lint`
Expected: no errors or warnings across the whole project.
