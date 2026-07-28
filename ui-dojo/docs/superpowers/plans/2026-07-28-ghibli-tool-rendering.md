# Ghibli Agent Tool Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `ghibliFilms` and `ghibliCharacters` tool output as cards on the AI SDK Ghibli demo page, instead of letting the agent recite the data as text.

**Architecture:** Two new presentational components (`FilmGridCard`, `CharacterGridCard`) following the existing `WatchlistCard` pattern (defensive normalization + shadcn `Card` grid). Wire them into the existing `tool-ghibliFilms`/`tool-ghibliCharacters` switch cases in `src/pages/ai-sdk/index.tsx`, which currently fall through to `null` on `output-available`. Update the Ghibli agent's instructions so it stops repeating the data as text once it's rendered.

**Tech Stack:** React 19, TypeScript (strict), Tailwind, shadcn/ui (`Card`), lucide-react icons, AI SDK v5 `useChat`/`UIMessage` tool parts.

## Global Constraints

- No test suite exists in this repo — do not invent test commands. Verification is `pnpm run vite:build` (typecheck) and manual exercise via `pnpm run dev`.
- Import from `src` via the `@/*` alias.
- Prefer `type` over `interface`; named exports; functional components with extracted prop types.
- Files kebab-case; components PascalCase.
- Merge Tailwind classes with `cn()` from `@/lib/utils` where variants are involved (not required for these static layouts).
- Scope is `src/pages/ai-sdk/index.tsx` and two new components only — do not touch Assistant UI, Mastra Client SDK pages, or `ghibli-tool.ts`.

---

### Task 1: `FilmGridCard` component

**Files:**
- Create: `src/components/film-grid-card.tsx`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  ```ts
  export type Film = {
    title: string;
    description?: string;
    movie_banner?: string;
    release_date?: string;
  };
  export type FilmGridCardProps = {
    films: unknown; // raw tool output, normalized internally
    onAdd?: (title: string) => void;
  };
  export const FilmGridCard = ({ films, onAdd }: FilmGridCardProps) => JSX.Element;
  ```
  Task 3 imports `FilmGridCard` from `@/components/film-grid-card` and passes `part.output` as `films`.

- [ ] **Step 1: Write the component**

```tsx
import { Film as FilmIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export type Film = {
  title: string;
  description?: string;
  movie_banner?: string;
  release_date?: string;
};

export type FilmGridCardProps = {
  films: unknown;
  onAdd?: (title: string) => void;
};

export const FilmGridCard = ({ films, onAdd }: FilmGridCardProps) => {
  const parsed = normalizeFilms(films);

  if (parsed.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
      {parsed.map((film) => (
        <Card key={film.title} className="flex flex-col">
          <CardHeader className="p-3 pb-0">
            {film.movie_banner ? (
              <img
                src={film.movie_banner}
                alt={film.title}
                className="h-40 w-full rounded-md object-cover"
              />
            ) : (
              <div className="flex h-40 w-full items-center justify-center rounded-md bg-muted">
                <FilmIcon className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
            <CardTitle className="mt-2 text-sm">{film.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col justify-between gap-2 p-3 pt-2">
            <div>
              {film.release_date && (
                <div className="text-xs text-muted-foreground">
                  {film.release_date}
                </div>
              )}
              {film.description && (
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {film.description}
                </p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAdd?.(film.title)}
            >
              Add to watchlist
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

function normalizeFilms(value: unknown): Film[] {
  const data = typeof value === "string" ? safeParse(value) : value;

  const raw = Array.isArray(data)
    ? data
    : data &&
        typeof data === "object" &&
        Array.isArray((data as { films?: unknown }).films)
      ? (data as { films: unknown[] }).films
      : [];

  const seen = new Set<string>();
  const films: Film[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { title } = item as Film;
    if (typeof title !== "string" || title.trim() === "" || seen.has(title)) {
      continue;
    }
    seen.add(title);
    films.push(item as Film);
  }
  return films;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run vite:build`
Expected: succeeds with no TypeScript errors referencing `film-grid-card.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/film-grid-card.tsx
git commit -m "feat: add FilmGridCard component for Ghibli films tool output"
```

---

### Task 2: `CharacterGridCard` component

**Files:**
- Create: `src/components/character-grid-card.tsx`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  ```ts
  export type Character = {
    name: string;
    gender?: string;
    age?: number;
    eye_color?: string;
    films?: { title: string }[];
  };
  export type CharacterGridCardProps = {
    characters: unknown; // raw tool output, normalized internally
  };
  export const CharacterGridCard = ({ characters }: CharacterGridCardProps) => JSX.Element;
  ```
  Task 3 imports `CharacterGridCard` from `@/components/character-grid-card` and passes `part.output` as `characters`.

- [ ] **Step 1: Write the component**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type Character = {
  name: string;
  gender?: string;
  age?: number;
  eye_color?: string;
  films?: { title: string }[];
};

export type CharacterGridCardProps = {
  characters: unknown;
};

export const CharacterGridCard = ({ characters }: CharacterGridCardProps) => {
  const parsed = normalizeCharacters(characters);

  if (parsed.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
      {parsed.map((character) => (
        <Card key={character.name}>
          <CardHeader className="p-3 pb-0">
            <CardTitle className="text-sm">{character.name}</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-2">
            <div className="grid grid-cols-3 gap-1 text-center text-xs text-muted-foreground">
              <div>
                <div className="font-medium text-foreground">
                  {character.gender ?? "—"}
                </div>
                Gender
              </div>
              <div>
                <div className="font-medium text-foreground">
                  {character.age ?? "—"}
                </div>
                Age
              </div>
              <div>
                <div className="font-medium text-foreground">
                  {character.eye_color ?? "—"}
                </div>
                Eyes
              </div>
            </div>
            {character.films && character.films.length > 0 && (
              <p className="mt-2 truncate text-xs text-muted-foreground">
                {character.films.map((film) => film.title).join(", ")}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

function normalizeCharacters(value: unknown): Character[] {
  const data = typeof value === "string" ? safeParse(value) : value;

  const raw = Array.isArray(data)
    ? data
    : data &&
        typeof data === "object" &&
        Array.isArray((data as { characters?: unknown }).characters)
      ? (data as { characters: unknown[] }).characters
      : [];

  const seen = new Set<string>();
  const characters: Character[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { name } = item as Character;
    if (typeof name !== "string" || name.trim() === "" || seen.has(name)) {
      continue;
    }
    seen.add(name);
    characters.push(item as Character);
  }
  return characters;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run vite:build`
Expected: succeeds with no TypeScript errors referencing `character-grid-card.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/character-grid-card.tsx
git commit -m "feat: add CharacterGridCard component for Ghibli characters tool output"
```

---

### Task 3: Wire cards into the AI SDK Ghibli page

**Files:**
- Modify: `src/pages/ai-sdk/index.tsx:55` (import), `:211-213` (handlers), `:296-323` (tool switch cases)

**Interfaces:**
- Consumes: `FilmGridCard` from `@/components/film-grid-card` (Task 1), `CharacterGridCard` from `@/components/character-grid-card` (Task 2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add imports**

In `src/pages/ai-sdk/index.tsx`, next to the existing `WatchlistCard` import (around line 55):

```tsx
import { WatchlistCard, type Film } from "@/components/watchlist-card";
import { FilmGridCard } from "@/components/film-grid-card";
import { CharacterGridCard } from "@/components/character-grid-card";
```

- [ ] **Step 2: Add `handleAddFilm` handler**

Immediately after `handleRemoveFilm` (around line 211-213):

```tsx
  const handleRemoveFilm = (title: string) => {
    sendMessage({ text: `Remove ${title} from my watchlist` });
  };

  const handleAddFilm = (title: string) => {
    sendMessage({ text: `Add ${title} to my watchlist` });
  };
```

- [ ] **Step 3: Split the `ghibliFilms`/`ghibliCharacters` switch case by tool and render on `output-available`**

Replace the existing combined case (around lines 296-323):

```tsx
                      case "tool-ghibliFilms":
                      case "tool-ghibliCharacters":
                        switch (part.state) {
                          case "input-available":
                            return (
                              <div
                                key={`${message.id}-${i}`}
                                className="flex items-center gap-2 text-muted-foreground text-sm"
                              >
                                <Loader size={14} />
                                {part.type === "tool-ghibliFilms"
                                  ? "Looking up films…"
                                  : "Looking up characters…"}
                              </div>
                            );
                          case "output-error":
                            return (
                              <div
                                key={`${message.id}-${i}`}
                                className="text-destructive text-sm"
                              >
                                Error: {part.errorText}
                              </div>
                            );
                          default:
                            return null;
                        }
```

with:

```tsx
                      case "tool-ghibliFilms":
                        switch (part.state) {
                          case "input-available":
                            return (
                              <div
                                key={`${message.id}-${i}`}
                                className="flex items-center gap-2 text-muted-foreground text-sm"
                              >
                                <Loader size={14} />
                                Looking up films…
                              </div>
                            );
                          case "output-available":
                            return (
                              <FilmGridCard
                                key={`${message.id}-${i}`}
                                films={part.output}
                                onAdd={handleAddFilm}
                              />
                            );
                          case "output-error":
                            return (
                              <div
                                key={`${message.id}-${i}`}
                                className="text-destructive text-sm"
                              >
                                Error: {part.errorText}
                              </div>
                            );
                          default:
                            return null;
                        }
                      case "tool-ghibliCharacters":
                        switch (part.state) {
                          case "input-available":
                            return (
                              <div
                                key={`${message.id}-${i}`}
                                className="flex items-center gap-2 text-muted-foreground text-sm"
                              >
                                <Loader size={14} />
                                Looking up characters…
                              </div>
                            );
                          case "output-available":
                            return (
                              <CharacterGridCard
                                key={`${message.id}-${i}`}
                                characters={part.output}
                              />
                            );
                          case "output-error":
                            return (
                              <div
                                key={`${message.id}-${i}`}
                                className="text-destructive text-sm"
                              >
                                Error: {part.errorText}
                              </div>
                            );
                          default:
                            return null;
                        }
```

- [ ] **Step 4: Typecheck**

Run: `pnpm run vite:build`
Expected: succeeds with no TypeScript errors in `src/pages/ai-sdk/index.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ai-sdk/index.tsx
git commit -m "feat: render Ghibli films/characters tool output as cards"
```

---

### Task 4: Update Ghibli agent instructions

**Files:**
- Modify: `src/mastra/agents/ghibli-agent.ts:21`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the no-repeat instruction**

In `src/mastra/agents/ghibli-agent.ts`, the instructions string currently ends with (line 21):

```
After calling show_watchlist, add only a brief one-line remark — do NOT repeat the film list as text, the UI renders it as cards.`,
```

Change to:

```
After calling show_watchlist, add only a brief one-line remark — do NOT repeat the film list as text, the UI renders it as cards.

After calling ghibliFilms or ghibliCharacters, add only a brief one-line remark — do NOT repeat the film/character list as text, the UI renders it as cards.`,
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run vite:build`
Expected: succeeds (this is a string-only change, but confirms nothing else broke).

- [ ] **Step 3: Commit**

```bash
git add src/mastra/agents/ghibli-agent.ts
git commit -m "chore: instruct Ghibli agent not to repeat rendered film/character data as text"
```

---

### Task 5: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev servers**

Run: `pnpm run dev`
Expected: Mastra server on port 4750 and Vite dev server both start without errors.

- [ ] **Step 2: Exercise films rendering**

In the browser, open the AI SDK Ghibli page and send "Tell me about Spirited Away" (or any films question).
Expected: a grid of film cards renders (poster/fallback icon, title, release date, description), agent's text reply is a brief remark only (no recited film list), no console errors.

- [ ] **Step 3: Exercise characters rendering**

Send "Who are the main characters in Princess Mononoke?"
Expected: a grid of character cards renders (name, gender/age/eye color, films), agent's text reply is a brief remark only.

- [ ] **Step 4: Exercise the "Add to watchlist" button**

Click "Add to watchlist" on a film card.
Expected: a chat message "Add <title> to my watchlist" is sent, the agent responds, and `WatchlistCard` updates to include the film.

- [ ] **Step 5: Final typecheck and lint**

Run: `pnpm run vite:build && pnpm run lint`
Expected: both succeed with no errors.
