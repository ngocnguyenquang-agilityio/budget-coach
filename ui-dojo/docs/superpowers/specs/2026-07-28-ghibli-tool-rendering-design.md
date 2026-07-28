# Ghibli agent tool rendering (AI SDK page)

## Problem

On `src/pages/ai-sdk/index.tsx`, the Ghibli agent's `ghibliFilms` and `ghibliCharacters` tool calls only render a loading spinner while `input-available`; their `output-available` state falls through to `default: return null`. The agent has no rendered UI to point to, so it recites film/character data back as text instead. This is inconsistent with `show_watchlist`, which already renders `WatchlistCard` and instructs the agent not to repeat the data as text.

## Scope

`src/pages/ai-sdk/index.tsx` and two new presentational components only. Assistant UI and Mastra Client SDK pages (which also use the Ghibli agent) are out of scope — they have no existing tool-rendering scaffolding and would need separate, framework-specific implementations. No changes to `ghibli-tool.ts` (no server-side filtering); tool output is rendered as-is, full list.

## Components

### `src/components/film-grid-card.tsx`

Renders `ghibliFilms` output: `{ title: string; description?: string; movie_banner?: string; release_date?: string }[]`.

- Responsive grid (`grid-cols-2 sm:grid-cols-3`) of poster cards, following `watchlist-card.tsx`'s visual language (shadcn `Card`, rounded poster image with `FilmIcon` fallback when `movie_banner` is missing).
- Each card: poster image, title, release date, description clamped to 2 lines (`line-clamp-2`), and an "Add to watchlist" button.
- `onAdd?: (title: string) => void` prop, called on button click.
- Defensive normalization mirroring `WatchlistCard`'s `normalizeFilms`: accept either a raw array or `{ films: [...] }` (and a JSON string of either), filter out entries without a non-empty `title`, dedupe by title.

### `src/components/character-grid-card.tsx`

Renders `ghibliCharacters` output: `{ name: string; gender?: string; age?: number; eye_color?: string; films: { title: string }[] }[]`.

- Grid of read-only text cards (`grid-cols-2 sm:grid-cols-3`): name as card title, gender/age/eye color as small stat rows (reuse the 3-column stat layout style from `weather-card.tsx`), and a caption listing the character's films (comma-joined titles).
- No interactive elements.
- Same defensive normalization approach: accept array or `{ characters: [...] }`/string, filter entries missing `name`, dedupe by name.

Both components go in `src/components/` (not `ai-elements/` or `ck/`), consistent with `watchlist-card.tsx`'s placement.

## Page wiring (`src/pages/ai-sdk/index.tsx`)

- Add `handleAddFilm = (title: string) => sendMessage({ text: \`Add ${title} to my watchlist\` })`, alongside the existing `handleRemoveFilm`.
- In the `case "tool-ghibliFilms": case "tool-ghibliCharacters":` switch, keep the existing `input-available` (loading) and `output-error` handling, but split the `output-available` case per tool type instead of falling to `default`:
  - `tool-ghibliFilms` + `output-available` → `<FilmGridCard films={part.output} onAdd={handleAddFilm} />`
  - `tool-ghibliCharacters` + `output-available` → `<CharacterGridCard characters={part.output} />`

## Agent instructions (`src/mastra/agents/ghibli-agent.ts`)

Add a line to the instructions, following the existing convention for `show_watchlist`:

> After calling ghibliFilms or ghibliCharacters, add only a brief one-line remark — do NOT repeat the film/character list as text, the UI renders it as cards.

## Error handling

Handled entirely by existing patterns: malformed/partial tool output is filtered out by the normalization helpers (never throws); `output-error` state already renders an inline error message and is untouched.

## Testing

No test suite in this repo. Verification is manual: run `pnpm run dev`, open the AI SDK Ghibli page, ask for films and characters, confirm cards render, confirm "Add to watchlist" round-trips into `WatchlistCard`, and run `pnpm run vite:build` to confirm typecheck passes.
