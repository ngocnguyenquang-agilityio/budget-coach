# Destination Guide RAG for Trip Planner — Design

## Goal

Add a Retrieval-Augmented Generation (RAG) knowledge base of destination
guides that `tripPlannerAgent` can query while building an itinerary. This is
a learning/demo feature: the app currently has no example of Mastra's RAG
primitives (`MDocument`, chunking, vector storage, `createVectorQueryTool`) —
everything so far is agents, tools, workflows, memory, storage, and
observability, but no vector search.

## Architecture

```
pnpm seed:guides (one-off script, run manually, not on app startup)
  → for each of 5 hardcoded cities (Lisbon, Tokyo, Paris, Bangkok, New York):
    → fetch article extract from the Wikivoyage MediaWiki API (no key required)
    → MDocument.fromText(extract).chunk()
    → embed each chunk with the Ollama embedding model (nomic-embed-text)
    → LibSQLVector.upsert() into the "destination_guides" index in mastra.db,
      with per-chunk metadata { city, source }

tripPlannerAgent (at chat time, per existing flow in
docs/superpowers/specs/2026-07-31-trip-planner-agent-design.md)
  → alongside askWeatherAgentTool, calls searchDestinationGuideTool({ city, query })
    → tool embeds the query with the same Ollama embedding model
    → vector similarity search against "destination_guides", filtered to that city
    → returns top-k matching guide chunks, or an empty array if the city isn't indexed
  → agent weaves any returned guide facts (neighborhoods, named venues, etiquette)
    into the itinerary; if the tool returns nothing, it proceeds on general
    knowledge with no caveat to the user
```

## Backend

1. **Add `@mastra/rag` as a dependency** (`pnpm add @mastra/rag`) — it is not
   currently installed. This package provides `MDocument` (chunking) and
   `createVectorQueryTool`, both used below.

2. **`src/mastra/vector-store.ts`** — new module exporting a single shared
   `LibSQLVector` instance, configured the same way `index.ts` configures
   `LibSQLStore` (`file:./mastra.db` locally, `TURSO_DATABASE_URL`/
   `TURSO_AUTH_TOKEN` when set). Both the seed script and the runtime tool
   import this instance rather than each constructing their own, so they
   always point at the same underlying index. The index is created with
   `createIndex` up front (not lazily), naming it `destination_guides` and
   setting its dimension to match `nomic-embed-text`'s output size (768) —
   the implementer must confirm this dimension against the actual model
   output before hardcoding it, since a mismatch will fail every upsert.

3. **`src/mastra/model.ts`** — add an exported Ollama embedding model, e.g.
   `export const ollamaEmbedding = ollama.textEmbeddingModel('nomic-embed-text');`,
   alongside the existing `ollama` chat client. Both the seed script and
   `searchDestinationGuideTool` reference this one export.

4. **`scripts/seed-destination-guides.ts`** — new standalone script, run via
   a new `pnpm seed:guides` entry in `package.json`'s `scripts`. Cities and
   their exact Wikivoyage page titles are pinned explicitly (not inferred),
   e.g.:
   `{ city: 'Lisbon', wikivoyageTitle: 'Lisbon' }`,
   `{ city: 'Tokyo', wikivoyageTitle: 'Tokyo' }`,
   `{ city: 'Paris', wikivoyageTitle: 'Paris' }`,
   `{ city: 'Bangkok', wikivoyageTitle: 'Bangkok' }`,
   `{ city: 'New York', wikivoyageTitle: 'New York City' }`
   (the implementer should verify each title resolves via the API before
   finalizing this list). For each city:
   - Fetch the Wikivoyage extract via the MediaWiki API
     (`action=query&prop=extracts&explaintext=1&titles=<wikivoyageTitle>`),
     no API key required.
   - If the fetch fails or returns no extract, log a warning (including the
     title that failed) and skip that city — the script continues with the
     rest rather than aborting.
   - Wrap the extract text in `MDocument.fromText(...)`, `.chunk()` it with
     the default recursive strategy, target chunk size ~512 characters with
     ~50 characters of overlap.
   - Embed each chunk with `ollamaEmbedding`.
   - Assign each chunk a deterministic id of the form `${city}-${chunkIndex}`
     so re-running the script is idempotent: before upserting a city's
     chunks, delete any existing vectors whose ids match that city's prefix.
     The intended mechanism is query-then-delete-by-id (vector stores
     generally support delete-by-id but not delete-by-metadata-filter), but
     the implementer must confirm `LibSQLVector`'s actual API supports
     listing/filtering existing ids by metadata without requiring a
     similarity query vector — if it doesn't, fall back to tracking seeded
     chunk ids in a small manifest file (e.g.
     `scripts/.destination-guides-manifest.json`) written by the script
     itself, and delete by that recorded id list instead. Then upsert the
     fresh set with metadata `{ city, source: 'wikivoyage' }`.
   - If Ollama itself is unreachable, the script fails fast with a clear
     error — same expectation as the rest of the app, which already requires
     a local Ollama server.
   - Logs a per-city summary (chunk count) so a successful run is easy to
     verify by eye.

5. **`src/mastra/tools/search-destination-guide-tool.ts`** — new tool.
   `createVectorQueryTool` builds its own input schema (typically a
   `queryText` plus an optional LLM-constructed filter) rather than a fixed
   `{ city, query }` shape, and does not guarantee hard server-side scoping
   to a single city on its own. To guarantee results are scoped to exactly
   the requested city (not left to the model's discretion), wrap it: either
   (a) construct `createVectorQueryTool` with a static/injected filter bound
   to `city` per call, or (b) skip `createVectorQueryTool` and write a plain
   `createTool` with input schema `{ city: string, query: string }` whose
   `execute` calls the shared `LibSQLVector` instance's query method
   directly with an explicit `filter: { city }`. The implementer should
   check the installed `@mastra/rag` version's actual API before choosing
   between (a) and (b); the requirement that matters is: **results must
   never leak content from a different city than the one asked about**.
   Whichever shape is chosen, results are capped at the top 4 matching
   chunks (`topK: 4`) and returned as an array of matched chunk texts —
   empty if the city has no indexed vectors, if the requested city string
   doesn't exactly match the seeded metadata value (e.g. "NYC" vs "New
   York" — no fuzzy matching is in scope), or if the underlying call
   throws (e.g. index doesn't exist yet, embedding call fails). The tool
   catches and swallows such errors internally rather than letting them
   propagate, so a missing/unseeded index or a city-name mismatch degrades
   to "no results" instead of failing the agent's whole turn.

6. **`src/mastra/agents/trip-planner-agent.ts`** — add
   `searchDestinationGuideTool` to its `tools` map (alongside the existing
   `askWeatherAgentTool`). Extend the instructions: after getting the
   weather, call `searchDestinationGuideTool` for the requested city; if it
   returns guide content, use specific details from it (named
   neighborhoods, venues, local tips) when writing the itinerary; if it
   returns nothing, proceed using general knowledge as before, without
   mentioning the guide lookup at all.

7. Register nothing new in `src/mastra/index.ts` — `LibSQLVector` isn't a
   Mastra `agents`/`workflows` registration, it's a plain storage client the
   tool and seed script both import directly, so no changes to the `Mastra`
   constructor are needed.

## Error handling

- **Seed script**: per-city fetch/parse failures are logged and skipped, not
  fatal; an unreachable Ollama server is fatal (fail fast with a clear
  message).
- **`searchDestinationGuideTool`**: any failure (index missing, embedding
  call failing) is caught and returns an empty result rather than throwing,
  so `tripPlannerAgent`'s turn always completes even for non-seeded cities
  or if seeding was never run.
- No changes to `askWeatherAgentTool` or existing trip-planner error
  handling.

## Testing / verification

No test runner is configured in this repo, so verification is manual:

1. `ollama pull nomic-embed-text` (new prerequisite, documented alongside the
   existing `llama3.1` pull requirement).
2. Run `pnpm seed:guides`; confirm it logs a successful chunk count for each
   of the 5 cities (or a warning + skip for any that failed to fetch).
3. In the chat UI, ask the trip planner for an itinerary in a seeded city
   (e.g. "3 days in Lisbon") and confirm the response reflects specific
   guide content (named neighborhoods/venues) rather than generic filler.
4. Ask for a non-seeded city (e.g. "2 days in Nairobi") and confirm it still
   produces a normal itinerary with no errors and no visible caveat about
   missing guide data.
5. Re-run `pnpm seed:guides` a second time and confirm it doesn't duplicate
   vectors (e.g. by checking a repeat query still returns a sane top-k count,
   not doubled).

## Out of scope

- No UI changes — this is purely a backend knowledge/tool addition to the
  existing trip-planner flow.
- No arbitrary/user-provided cities — the knowledge base is a fixed set of 5
  hardcoded cities seeded via a manual script, not fetched/embedded on
  demand for arbitrary cities.
- No caveat/messaging to the user when a city isn't in the knowledge base —
  silent fallback to the agent's general knowledge.
- No changes to `weatherAgent`, `askWeatherAgentTool`, or the existing
  weather-workflow / activity-plan features.
- No new API route or persistence changes — this only adds a tool the
  existing `tripPlannerAgent` flow (per
  `2026-07-31-trip-planner-agent-design.md`) can call; the itinerary is
  still generated and persisted exactly as that design describes.
- No fuzzy/alias matching on city names — if the city string the agent
  passes to the tool doesn't exactly match the seeded metadata value (e.g.
  "NYC" vs "New York"), the lookup silently returns no results and the
  itinerary falls back to general knowledge, consistent with the "no
  caveat" fallback behavior described above.
